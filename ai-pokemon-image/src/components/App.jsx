import { useState, useRef, useEffect } from 'react'
import '../styles/App.css'

function App() {
  const [baseImage, setBaseImage] = useState(null)
  const [baseImageFile, setBaseImageFile] = useState(null)
  const [backgroundMask, setBackgroundMask] = useState(null)
  const [pokemonImage, setPokemonImage] = useState(null)
  const [pokemonStyle, setPokemonStyle] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessingBackground, setIsProcessingBackground] = useState(false)
  const [backgroundThreshold, setBackgroundThreshold] = useState(0.5)
  const fileInputRef = useRef(null)
  const imageRef = useRef(null)
  
  // rembg API endpoint - defaults to localhost:5001, can be overridden with env variable
  const REMBG_API_URL = import.meta.env.VITE_REMBG_API_URL || 'http://localhost:5001/remove-background'

  const handleImageSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      const imageUrl = URL.createObjectURL(file)
      setBaseImage(imageUrl)
      setBaseImageFile(file)
      // Clear Pokemon overlay when new image is selected
      setPokemonImage(null)
      setPokemonStyle(null)
      setBackgroundMask(null)
      // Process background after image loads
      setIsProcessingBackground(true)
    }
  }

  useEffect(() => {
    const processBackground = async () => {
      if (!baseImageFile || !imageRef.current) return

      try {
        // Wait for image to load
        await new Promise((resolve, reject) => {
          if (imageRef.current.complete && imageRef.current.naturalWidth > 0) {
            resolve()
          } else {
            imageRef.current.onload = resolve
            imageRef.current.onerror = reject
            setTimeout(() => reject(new Error('Image load timeout')), 10000)
          }
        })

        // Check if image is valid
        if (!imageRef.current.naturalWidth || !imageRef.current.naturalHeight) {
          throw new Error('Invalid image dimensions')
        }

        // Call rembg API to get background-removed image
        const formData = new FormData()
        formData.append('image', baseImageFile)

        const response = await fetch(REMBG_API_URL, {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          throw new Error(`API error: ${response.status} - ${errorText}`)
        }

        const blob = await response.blob()
        
        if (!blob || blob.size === 0) {
          throw new Error('Background removal returned empty result')
        }

        // Create canvas to get mask data from the result
        // rembg returns an image with transparent background
        const img = new Image()
        const blobUrl = URL.createObjectURL(blob)
        img.src = blobUrl
        
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          setTimeout(() => reject(new Error('Processed image load timeout')), 10000)
        })

        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          throw new Error('Could not get canvas context')
        }
        
        ctx.drawImage(img, 0, 0)

        // Get image data to create mask
        // rembg returns image with transparent background, so low alpha = background
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const mask = new Uint8Array(imageData.data.length / 4)
        
        for (let i = 0; i < imageData.data.length; i += 4) {
          const alpha = imageData.data[i + 3] / 255
          // If alpha is below threshold, it's background (1), otherwise foreground (0)
          mask[i / 4] = alpha < backgroundThreshold ? 1 : 0
        }

        // Clean up blob URL
        URL.revokeObjectURL(blobUrl)

        setBackgroundMask({
          data: mask,
          width: canvas.width,
          height: canvas.height
        })
      } catch (error) {
        console.error('Error processing background:', error)
        alert(`Failed to process background: ${error.message || 'Unknown error'}. Make sure your rembg backend server is running at ${REMBG_API_URL}`)
        setIsProcessingBackground(false)
      } finally {
        setIsProcessingBackground(false)
      }
    }

    if (baseImageFile && imageRef.current) {
      processBackground()
    }
  }, [baseImageFile, backgroundThreshold, REMBG_API_URL])

  const handleButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleBack = () => {
    if (baseImage && baseImage.startsWith('blob:')) {
      URL.revokeObjectURL(baseImage)
    }
    setBaseImage(null)
    setBaseImageFile(null)
    setPokemonImage(null)
    setPokemonStyle(null)
    setBackgroundMask(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const findBackgroundPosition = (scale, imageWidth, imageHeight, maskWidth, maskHeight) => {
    const pokemonWidth = imageWidth * scale
    const pokemonHeight = imageHeight * scale
    
    // Scale mask coordinates to image coordinates
    const scaleX = imageWidth / maskWidth
    const scaleY = imageHeight / maskHeight
    
    const maxAttempts = 100
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random position
      const maxX = imageWidth - pokemonWidth
      const maxY = imageHeight - pokemonHeight
      
      if (maxX <= 0 || maxY <= 0) {
        // Pokemon too large, use center
        return { x: imageWidth / 2 - pokemonWidth / 2, y: imageHeight / 2 - pokemonHeight / 2 }
      }
      
      const randomX = Math.random() * maxX
      const randomY = Math.random() * maxY
      
      // Check if position is in background area
      const centerX = randomX + pokemonWidth / 2
      const centerY = randomY + pokemonHeight / 2
      
      // Convert to mask coordinates
      const maskX = Math.floor(centerX / scaleX)
      const maskY = Math.floor(centerY / scaleY)
      
      if (maskX >= 0 && maskX < maskWidth && maskY >= 0 && maskY < maskHeight) {
        const maskIndex = maskY * maskWidth + maskX
        if (backgroundMask.data[maskIndex] === 1) {
          // Found background position
          return { x: randomX, y: randomY }
        }
      }
    }
    
    // Fallback: return random position if no background found
    const maxX = imageWidth - pokemonWidth
    const maxY = imageHeight - pokemonHeight
    return {
      x: Math.max(0, Math.random() * maxX),
      y: Math.max(0, Math.random() * maxY)
    }
  }

  const handleGenerate = async () => {
    if (!baseImage || !backgroundMask) return
    
    setIsLoading(true)
    try {
      // Generate random Pokemon ID between 1-151
      const randomPokemonId = Math.floor(Math.random() * 151) + 1
      
      // Fetch Pokemon data from PokéAPI
      const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomPokemonId}/`)
      const data = await response.json()
      
      // Get the Pokemon image URL (prefer official artwork, fallback to front default)
      const imageUrl = data.sprites.other?.['official-artwork']?.front_default || 
                       data.sprites.front_default
      
      if (imageUrl && imageRef.current) {
        // Generate random scale between 0.0 and 0.9
        const randomScale = Math.random() * 0.9
        
        // Get image dimensions
        const imageWidth = imageRef.current.naturalWidth || imageRef.current.width
        const imageHeight = imageRef.current.naturalHeight || imageRef.current.height
        
        // Find a position in the background
        const position = findBackgroundPosition(
          randomScale,
          imageWidth,
          imageHeight,
          backgroundMask.width,
          backgroundMask.height
        )
        
        // Convert to percentage for CSS
        const leftPercent = (position.x / imageWidth) * 100
        const topPercent = (position.y / imageHeight) * 100
        
        setPokemonImage(imageUrl)
        setPokemonStyle({
          scale: randomScale,
          left: `${leftPercent}%`,
          top: `${topPercent}%`
        })
      }
    } catch (error) {
      console.error('Error fetching Pokemon:', error)
      alert('Failed to fetch Pokemon. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className="app-container">
        <h1>Pokéfy Your Image</h1>
        {!baseImage ? (
          <button onClick={handleButtonClick} className="select-button">
            Select Image
          </button>
        ) : (
          <>
            {isProcessingBackground && (
              <div className="processing-message">
                Processing background with rembg... This may take a moment.
              </div>
            )}
            <div className="image-container">
              <img 
                ref={imageRef}
                src={baseImage} 
                alt="Selected" 
                className="selected-image" 
              />
              {pokemonImage && pokemonStyle && (
                <img 
                  src={pokemonImage} 
                  alt="Pokemon overlay" 
                  className="pokemon-overlay"
                  style={{
                    transform: `scale(${pokemonStyle.scale})`,
                    left: pokemonStyle.left,
                    top: pokemonStyle.top
                  }}
                />
              )}
            </div>
            <div className="controls">
              <div className="slider-container">
                <label htmlFor="threshold-slider">
                  Background Threshold: {backgroundThreshold.toFixed(2)}
                </label>
                <input
                  id="threshold-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={backgroundThreshold}
                  onChange={(e) => setBackgroundThreshold(parseFloat(e.target.value))}
                  className="threshold-slider"
                  disabled={isProcessingBackground}
                />
                <div className="slider-hint">
                  Lower values = more background detected
                </div>
              </div>
            </div>
            <div className="button-group">
              <button onClick={handleBack} className="back-button">
                Back
              </button>
              <button 
                onClick={handleGenerate} 
                className="generate-button"
                disabled={isLoading || isProcessingBackground || !backgroundMask}
              >
                {isLoading ? 'Loading...' : 'Generate'}
              </button>
            </div>
          </>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageSelect}
          accept="image/*"
          style={{ display: 'none' }}
        />
      </div>
    </>
  )
}

export default App
