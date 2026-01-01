"""
DeepLab Backend Server for React App
Run this server to process semantic segmentation using DeepLab for people detection

Installation:
    pip install flask flask-cors pillow numpy torch torchvision

Usage:
    python rembg_server.py
"""

from flask import Flask, request, send_file
from flask_cors import CORS
from io import BytesIO
from PIL import Image
import numpy as np
import os
import torch
import torchvision.transforms as transforms
from torchvision.models.segmentation import deeplabv3_resnet50, DeepLabV3_ResNet50_Weights

app = Flask(__name__)
CORS(app)  # Enable CORS for React app

# Initialize DeepLab model
deeplab_model = None
device = None

def load_deeplab_model():
    """Load DeepLab model for semantic segmentation"""
    global deeplab_model, device
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Load DeepLabV3 with ResNet50 backbone (pre-trained on COCO)
        # COCO classes include: person (class 15), sky, ground, etc.
        deeplab_model = deeplabv3_resnet50(weights=DeepLabV3_ResNet50_Weights.COCO_WITH_VOC_LABELS_V1)
        deeplab_model.to(device)
        deeplab_model.eval()
        
        print(f"DeepLab model loaded successfully on {device}")
        print("Model is pre-trained on COCO dataset with person detection")
        return True
    except Exception as e:
        print(f"Error loading DeepLab model: {e}")
        import traceback
        traceback.print_exc()
        return False

# Try to load DeepLab model on startup
if not load_deeplab_model():
    print("Falling back to simple color-based segmentation")

def simple_sky_ground_segmentation(image):
    """Simple color-based segmentation fallback - returns subject (people-focused), sky, ground, other"""
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    img_array = np.array(image)
    height, width = img_array.shape[:2]
    
    sky_mask = np.zeros((height, width), dtype=np.uint8)
    ground_mask = np.zeros((height, width), dtype=np.uint8)
    other_mask = np.zeros((height, width), dtype=np.uint8)
    subject_mask = np.zeros((height, width), dtype=np.uint8)
    
    for y in range(height):
        for x in range(width):
            r, g, b = img_array[y, x, :3]
            brightness = (r + g + b) / 3
            saturation = max(r, g, b) - min(r, g, b) if brightness > 0 else 0
            
            # Sky detection: bright, blue-ish
            # Check sky FIRST - sky takes priority
            # Very lenient sky detection - prioritize detecting sky correctly
            is_sky_like = (
                brightness > 80 and  # Bright (very lenient)
                b > 80 and  # Some blue component (very lenient)
                (b >= r or b >= g) and  # Blue is at least equal to or higher than one other component
                (b > r + 5 or b > g + 5) and  # Blue is somewhat dominant (very lenient)
                saturation < 180  # Not too colorful (very lenient)
            )
            
            # Ground detection: green (grass) or brown (dirt/road)
            # CRITICAL: Explicitly exclude ANY blue-dominant pixels - blue MUST be low
            is_green_dominant = g > r + 20 and g > b + 20
            is_brownish = r > 100 and g > 80 and b < 100 and abs(r - g) < 30
            
            # Ground must NOT be sky-like - blue must be LOW (this is the key separation)
            is_ground_like = (
                not is_sky_like and  # NOT sky (double check)
                b < 90 and  # Blue is LOW (critical for separating from sky - lowered threshold)
                (
                    (is_green_dominant and g > 100 and brightness < 230) or  # Grass
                    (is_brownish and brightness < 200) or  # Dirt/road
                    (g > 90 and r > 70 and b < 80 and brightness < 210 and b < r and b < g) or  # Earth tones (blue is lowest)
                    (r > 80 and g > 70 and b < 70 and brightness < 190)  # Darker earth tones (very low blue)
                )
            )
            
            # People detection: skin tones or clothing colors
            is_skin_tone = (r > 150 and g > 100 and b > 80 and r > g and r > b)
            is_clothing_color = (
                brightness > 80 and brightness < 220 and
                not is_blue_dominant and
                not is_green_dominant and
                not is_brownish
            )
            
            # Classify
            if is_skin_tone or is_clothing_color:
                subject_mask[y, x] = 255
            elif is_sky_like:
                sky_mask[y, x] = 255
            elif is_ground_like:
                ground_mask[y, x] = 255
            else:
                other_mask[y, x] = 255
    
    return subject_mask, sky_mask, ground_mask, other_mask

def segment_with_deeplab(image):
    """Use DeepLab to segment image into subject (people), sky, ground, and other"""
    if deeplab_model is None:
        return simple_sky_ground_segmentation(image)
    
    try:
        # Convert PIL to numpy array
        img_array = np.array(image.convert('RGB'))
        height, width = img_array.shape[:2]
        
        # Preprocess image for DeepLab
        # DeepLab expects normalized input
        preprocess = transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        
        input_tensor = preprocess(image).unsqueeze(0).to(device)
        
        # Run inference
        with torch.no_grad():
            output = deeplab_model(input_tensor)['out'][0]
        
        # Get predicted classes
        # COCO classes: 0=background, 15=person, and other classes
        # We'll map: person=subject, sky/ground/other based on position and color
        predictions = output.argmax(0).cpu().numpy()
        
        # Resize predictions to match original image if needed
        if predictions.shape[0] != height or predictions.shape[1] != width:
            pred_image = Image.fromarray(predictions.astype(np.uint8))
            pred_image = pred_image.resize((width, height), Image.NEAREST)
            predictions = np.array(pred_image)
        
        # Initialize masks
        sky_mask = np.zeros((height, width), dtype=np.uint8)
        ground_mask = np.zeros((height, width), dtype=np.uint8)
        other_mask = np.zeros((height, width), dtype=np.uint8)
        subject_mask = np.zeros((height, width), dtype=np.uint8)
        
        # COCO class IDs (from DeepLab COCO weights):
        # 0 = background, 15 = person
        PERSON_CLASS = 15
        
        # First pass: identify people
        for y in range(height):
            for x in range(width):
                class_id = predictions[y, x]
                if class_id == PERSON_CLASS:
                    subject_mask[y, x] = 255
        
        # Second pass: classify background pixels using intelligent detection
        for y in range(height):
            for x in range(width):
                # Skip if already classified as person
                if subject_mask[y, x] == 255:
                    continue
                
                class_id = predictions[y, x]
                r, g, b = img_array[y, x, :3]
                brightness = (r + g + b) / 3
                
                # Calculate color characteristics
                saturation = max(r, g, b) - min(r, g, b) if brightness > 0 else 0
                
                # Sky detection: bright, blue-ish
                # Sky characteristics: high brightness, blue dominant, low saturation variation
                # Check sky FIRST before ground to avoid misclassification
                # Very lenient sky detection - prioritize detecting sky correctly
                is_sky_like = (
                    brightness > 80 and  # Bright (very lenient)
                    b > 80 and  # Some blue component (very lenient)
                    (b >= r or b >= g) and  # Blue is at least equal to or higher than one other component
                    (b > r + 5 or b > g + 5) and  # Blue is somewhat dominant (very lenient)
                    saturation < 180  # Not too colorful (sky is usually uniform, very lenient)
                )
                
                # Ground detection: green (grass) or brown (dirt/road)
                # Ground characteristics: green or brown, medium brightness
                # CRITICAL: Explicitly exclude ANY blue-dominant pixels - blue MUST be low
                is_green_dominant = g > r + 20 and g > b + 20
                is_brownish = r > 100 and g > 80 and b < 100 and abs(r - g) < 30
                
                # Ground must NOT be sky-like - blue must be LOW (this is the key separation)
                is_ground_like = (
                    not is_sky_like and  # NOT sky (double check)
                    b < 90 and  # Blue is LOW (critical for separating from sky - lowered threshold)
                    (
                        (is_green_dominant and g > 100 and brightness < 230) or  # Grass
                        (is_brownish and brightness < 200) or  # Dirt/road
                        (g > 90 and r > 70 and b < 80 and brightness < 210 and b < r and b < g) or  # Earth tones (blue is lowest)
                        (r > 80 and g > 70 and b < 70 and brightness < 190)  # Darker earth tones (very low blue)
                    )
                )
                
                # Classify based on actual visual features - sky takes priority
                if is_sky_like:
                    sky_mask[y, x] = 255
                elif is_ground_like:
                    ground_mask[y, x] = 255
                else:
                    # Other background (buildings, walls, objects, etc.)
                    other_mask[y, x] = 255
        
        return subject_mask, sky_mask, ground_mask, other_mask
    except Exception as e:
        print(f"Error in DeepLab segmentation: {e}")
        import traceback
        traceback.print_exc()
        return simple_sky_ground_segmentation(image)

def create_segmentation_mask(subject_mask, sky_mask, ground_mask, other_mask):
    """Create a colored segmentation mask image with distinct colors"""
    height, width = sky_mask.shape
    result = np.zeros((height, width, 3), dtype=np.uint8)
    
    # Subject = magenta/pink (foreground objects) - more distinct from red
    result[subject_mask > 0] = [255, 0, 255]
    # Sky = cyan (top background) - more distinct from blue
    result[sky_mask > 0] = [0, 255, 255]
    # Ground = orange (bottom background) - more distinct from green
    result[ground_mask > 0] = [255, 165, 0]
    # Other = yellow (other background like walls, buildings)
    result[other_mask > 0] = [255, 255, 0]
    
    return Image.fromarray(result)

@app.route('/segment', methods=['POST'])
def segment():
    """Segment image into sky, ground, and subject"""
    try:
        if 'image' not in request.files:
            return {'error': 'No image file provided'}, 400

        file = request.files['image']
        
        if file.filename == '':
            return {'error': 'No file selected'}, 400

        input_image = Image.open(file.stream).convert('RGB')
        
        # Perform segmentation - returns subject, sky, ground, other
        subject_mask, sky_mask, ground_mask, other_mask = segment_with_deeplab(input_image)
        
        # Create colored segmentation mask
        segmentation_image = create_segmentation_mask(subject_mask, sky_mask, ground_mask, other_mask)
        
        # Convert to bytes
        img_io = BytesIO()
        segmentation_image.save(img_io, 'PNG')
        img_io.seek(0)

        return send_file(img_io, mimetype='image/png')
    
    except Exception as e:
        return {'error': str(e)}, 500

@app.route('/remove-background', methods=['POST'])
def remove_background():
    """Remove background (sky + ground) leaving only subject"""
    try:
        if 'image' not in request.files:
            return {'error': 'No image file provided'}, 400

        file = request.files['image']
        
        if file.filename == '':
            return {'error': 'No file selected'}, 400

        input_image = Image.open(file.stream).convert('RGB')
        
        # Segment image - returns subject, sky, ground, other
        subject_mask, sky_mask, ground_mask, other_mask = segment_with_deeplab(input_image)
        
        # Create output with transparent background (all background categories)
        img_array = np.array(input_image)
        combined_bg_mask = (sky_mask > 0) | (ground_mask > 0) | (other_mask > 0)
        
        # Convert to RGBA
        rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
        rgba[:, :, :3] = img_array
        rgba[:, :, 3] = 255  # Full opacity
        rgba[combined_bg_mask, 3] = 0  # Transparent for background
        
        output_image = Image.fromarray(rgba, 'RGBA')

        # Convert to bytes
        img_io = BytesIO()
        output_image.save(img_io, 'PNG')
        img_io.seek(0)

        return send_file(img_io, mimetype='image/png')
    
    except Exception as e:
        return {'error': str(e)}, 500

@app.route('/health', methods=['GET'])
def health():
    status = 'ok' if deeplab_model is not None else 'fallback'
    return {'status': status, 'service': 'deeplab', 'model_loaded': deeplab_model is not None}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    print(f'Starting DeepLab server on http://localhost:{port}')
    print('Make sure dependencies are installed: pip install -r requirements.txt')
    if deeplab_model is None:
        print('Note: DeepLab model not loaded, using fallback segmentation')
    app.run(host='0.0.0.0', port=port, debug=True)
