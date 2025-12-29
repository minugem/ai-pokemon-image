"""
rembg Backend Server for React App
Run this server to process background removal using rembg

Installation:
    pip install rembg flask flask-cors pillow

Usage:
    python rembg_server.py
"""

from flask import Flask, request, send_file
from flask_cors import CORS
from rembg import remove
from io import BytesIO
from PIL import Image
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for React app

@app.route('/remove-background', methods=['POST'])
def remove_background():
    try:
        if 'image' not in request.files:
            return {'error': 'No image file provided'}, 400

        file = request.files['image']
        
        if file.filename == '':
            return {'error': 'No file selected'}, 400

        # Read the image
        input_image = Image.open(file.stream)
        
        # Remove background using rembg
        output_image = remove(input_image)

        # Convert to bytes
        img_io = BytesIO()
        output_image.save(img_io, 'PNG')
        img_io.seek(0)

        return send_file(img_io, mimetype='image/png')
    
    except Exception as e:
        return {'error': str(e)}, 500

@app.route('/health', methods=['GET'])
def health():
    return {'status': 'ok', 'service': 'rembg'}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))  # Use port 5001 by default, or PORT env variable
    print(f'Starting rembg server on http://localhost:{port}')
    print('Make sure rembg is installed: pip install rembg flask flask-cors pillow')
    app.run(host='0.0.0.0', port=port, debug=True)

