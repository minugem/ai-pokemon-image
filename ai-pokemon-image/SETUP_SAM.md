# Setting up SAM (Segment Anything Model)

## Installation Steps

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Install segment-anything package:**
   ```bash
   pip install git+https://github.com/facebookresearch/segment-anything.git
   ```

3. **Download SAM model checkpoint:**
   
   Choose one of the following models (larger = more accurate but slower):
   
   - **sam_vit_h_4b8939.pth** (2.4GB) - Most accurate, recommended
   - **sam_vit_l_0b3195.pth** (1.2GB) - Good balance
   - **sam_vit_b_01ec64.pth** (375MB) - Fastest, less accurate
   
   Download from: https://github.com/facebookresearch/segment-anything#model-checkpoints
   
   Place the `.pth` file in the same directory as `rembg_server.py`

4. **Set environment variable (optional):**
   ```bash
   export SAM_CHECKPOINT=/path/to/sam_vit_h_4b8939.pth
   ```

5. **Run the server:**
   ```bash
   python rembg_server.py
   ```

## Notes

- The server will automatically fall back to simple color-based segmentation if SAM model is not found
- GPU is recommended for faster processing (CUDA will be used automatically if available)
- First run will be slower as the model loads into memory

