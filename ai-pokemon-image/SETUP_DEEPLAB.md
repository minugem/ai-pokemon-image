# Setting up DeepLab for Semantic Segmentation

## Installation Steps

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the server:**
   ```bash
   python rembg_server.py
   ```

## How It Works

DeepLabV3 with ResNet50 backbone is used for semantic segmentation. The model is:
- Pre-trained on COCO dataset
- Automatically downloads weights on first run
- Specifically trained to detect people (class 15)
- No manual model download required!

## Notes

- The model will automatically download weights (~170MB) on first run
- GPU is recommended for faster processing (CUDA will be used automatically if available)
- First run will be slower as the model loads into memory
- The model is optimized for people detection, which is perfect for this use case

## Model Details

- **Architecture**: DeepLabV3 with ResNet50 backbone
- **Pre-trained on**: COCO dataset
- **Person class ID**: 15
- **Input**: RGB images of any size (automatically resized)
- **Output**: Semantic segmentation masks for people, sky, ground, and other categories

