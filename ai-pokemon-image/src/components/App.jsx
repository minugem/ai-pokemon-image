import { useState, useRef, useEffect } from 'react'
import '../styles/App.css'

function App() {
  const [baseImage, setBaseImage] = useState(null)
  const [baseImageFile, setBaseImageFile] = useState(null)
  const [backgroundMask, setBackgroundMask] = useState(null)
  const [originalImageData, setOriginalImageData] = useState(null) // Store original processed image data
  const [pokemonList, setPokemonList] = useState([]) // Array of {imageUrl, scale, left, top}
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessingBackground, setIsProcessingBackground] = useState(false)
  const [backgroundThreshold, setBackgroundThreshold] = useState(0.5)
  const [showMaskOverlay, setShowMaskOverlay] = useState(false)
  const fileInputRef = useRef(null)
  const imageRef = useRef(null)
  const maskCanvasRef = useRef(null)
  
  // rembg API endpoint - defaults to localhost:5001, can be overridden with env variable
  const REMBG_API_URL = import.meta.env.VITE_REMBG_API_URL || 'http://localhost:5001/remove-background'

  const handleImageSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      const imageUrl = URL.createObjectURL(file)
      setBaseImage(imageUrl)
      setBaseImageFile(file)
      // Clear Pokemon overlay when new image is selected
      setPokemonList([])
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

        // Get image data and store it for threshold recalculation
        // rembg returns image with transparent background, so low alpha = background
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        
        // Store original image data for threshold recalculation
        setOriginalImageData({
          data: new Uint8ClampedArray(imageData.data),
          width: canvas.width,
          height: canvas.height
        })

        // Calculate initial mask
        const mask = new Uint8Array(imageData.data.length / 4)
        for (let i = 0; i < imageData.data.length; i += 4) {
          const alpha = imageData.data[i + 3] / 255
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
      // Always process when baseImageFile changes (new image selected)
      processBackground()
    }
  }, [baseImageFile, REMBG_API_URL])

  // Recalculate mask when threshold changes (without calling API)
  useEffect(() => {
    if (!originalImageData) return

    const mask = new Uint8Array(originalImageData.data.length / 4)
    for (let i = 0; i < originalImageData.data.length; i += 4) {
      const alpha = originalImageData.data[i + 3] / 255
      mask[i / 4] = alpha < backgroundThreshold ? 1 : 0
    }

    setBackgroundMask({
      data: mask,
      width: originalImageData.width,
      height: originalImageData.height
    })
  }, [backgroundThreshold, originalImageData])

  // Update mask overlay visualization
  useEffect(() => {
    if (!backgroundMask || !maskCanvasRef.current || !imageRef.current) return

    const canvas = maskCanvasRef.current
    const img = imageRef.current
    
    // Match canvas size to displayed image
    const rect = img.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Scale mask to canvas size
    const scaleX = canvas.width / backgroundMask.width
    const scaleY = canvas.height / backgroundMask.height

    // Create image data for overlay
    const imageData = ctx.createImageData(canvas.width, canvas.height)
    
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const maskX = Math.floor(x / scaleX)
        const maskY = Math.floor(y / scaleY)
        
        if (maskX >= 0 && maskX < backgroundMask.width && maskY >= 0 && maskY < backgroundMask.height) {
          const maskIndex = maskY * backgroundMask.width + maskX
          const isBackground = backgroundMask.data[maskIndex] === 1
          
          const pixelIndex = (y * canvas.width + x) * 4
          
          if (isBackground) {
            // Highlight background areas in semi-transparent green
            imageData.data[pixelIndex] = 0      // R
            imageData.data[pixelIndex + 1] = 255  // G
            imageData.data[pixelIndex + 2] = 0    // B
            imageData.data[pixelIndex + 3] = 100  // Alpha (semi-transparent)
          } else {
            // Make foreground transparent
            imageData.data[pixelIndex] = 0
            imageData.data[pixelIndex + 1] = 0
            imageData.data[pixelIndex + 2] = 0
            imageData.data[pixelIndex + 3] = 0
          }
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0)
  }, [backgroundMask, backgroundThreshold, showMaskOverlay])

  const handleButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleBack = () => {
    if (baseImage && baseImage.startsWith('blob:')) {
      URL.revokeObjectURL(baseImage)
    }
    setBaseImage(null)
    setBaseImageFile(null)
    setPokemonList([])
    setBackgroundMask(null)
    setOriginalImageData(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Check if two Pokemon rectangles overlap (with padding to prevent being too close)
  const checkCollision = (pokemon1, pokemon2, padding = 10) => {
    const pokemon1Right = pokemon1.x + pokemon1.width + padding
    const pokemon1Bottom = pokemon1.y + pokemon1.height + padding
    const pokemon1Left = pokemon1.x - padding
    const pokemon1Top = pokemon1.y - padding
    
    const pokemon2Right = pokemon2.x + pokemon2.width + padding
    const pokemon2Bottom = pokemon2.y + pokemon2.height + padding
    const pokemon2Left = pokemon2.x - padding
    const pokemon2Top = pokemon2.y - padding

    // Check if rectangles overlap
    return !(
      pokemon1Right < pokemon2Left ||
      pokemon1Left > pokemon2Right ||
      pokemon1Bottom < pokemon2Top ||
      pokemon1Top > pokemon2Bottom
    )
  }

  // Check if a position collides with existing Pokemon
  const checkCollisionWithExisting = (x, y, width, height, existingPokemon) => {
    const newPokemon = { x, y, width, height }
    
    for (const existing of existingPokemon) {
      if (checkCollision(newPokemon, existing)) {
        return true
      }
    }
    return false
  }

  const findBackgroundPosition = (scale, imageWidth, imageHeight, maskWidth, maskHeight, existingPokemon = [], verticalConstraint = null) => {
    const pokemonWidth = imageWidth * scale
    const pokemonHeight = imageHeight * scale
    
    // Scale mask coordinates to image coordinates
    const scaleX = imageWidth / maskWidth
    const scaleY = imageHeight / maskHeight
    
    // Check if Pokemon fits in image
    const maxX = imageWidth - pokemonWidth
    let maxY = imageHeight - pokemonHeight
    let minY = 0
    
    // Apply vertical constraint based on Pokemon type
    if (verticalConstraint === 'top') {
      // Flying Pokemon: only in top half
      maxY = imageHeight / 2 - pokemonHeight
      minY = 0
    } else if (verticalConstraint === 'bottom') {
      // Ground Pokemon: only in bottom half
      minY = imageHeight / 2
      maxY = imageHeight - pokemonHeight
    }
    
    if (maxX <= 0 || maxY <= 0 || minY >= maxY) {
      // Pokemon too large or constraint makes it impossible
      return null
    }
    
    // Helper function to check if a point is in background
    const isBackgroundPoint = (x, y) => {
      const maskX = Math.floor(x / scaleX)
      const maskY = Math.floor(y / scaleY)
      
      if (maskX >= 0 && maskX < maskWidth && maskY >= 0 && maskY < maskHeight) {
        const maskIndex = maskY * maskWidth + maskX
        return backgroundMask.data[maskIndex] === 1
      }
      return false
    }
    
    // Helper function to check if entire Pokemon area is in background
    // Checks a small area around the position for any non-background pixels
    const isPositionValid = (x, y) => {
      // Define the area to check - the Pokemon's bounding box
      const checkAreaWidth = pokemonWidth
      const checkAreaHeight = pokemonHeight
      
      // Sample points in a grid pattern across the area
      // Use a reasonable sampling density (check every N pixels)
      const sampleDensity = Math.max(5, Math.min(pokemonWidth, pokemonHeight) / 10) // Sample every 5-10% of size
      const stepX = Math.max(1, checkAreaWidth / sampleDensity)
      const stepY = Math.max(1, checkAreaHeight / sampleDensity)
      
      // Check all points in the area
      for (let checkY = y; checkY < y + checkAreaHeight; checkY += stepY) {
        for (let checkX = x; checkX < x + checkAreaWidth; checkX += stepX) {
          // If any point is NOT in background, reject this position
          if (!isBackgroundPoint(checkX, checkY)) {
            return false
          }
        }
      }
      
      // All checked points are in background - position is valid
      return true
    }
    
    // Try to find a valid background position
    const maxAttempts = 500 // Increased attempts for better coverage
    const backgroundPositions = []
    
    // First, collect all potential background positions
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const randomX = Math.random() * maxX
      const randomY = minY + Math.random() * (maxY - minY) // Respect vertical constraint
      
      if (isPositionValid(randomX, randomY)) {
        // Check collision with existing Pokemon
        if (!checkCollisionWithExisting(randomX, randomY, pokemonWidth, pokemonHeight, existingPokemon)) {
          backgroundPositions.push({ x: randomX, y: randomY })
        }
      }
    }
    
    // If we found valid positions, return a random one
    if (backgroundPositions.length > 0) {
      const randomIndex = Math.floor(Math.random() * backgroundPositions.length)
      return backgroundPositions[randomIndex]
    }
    
    // If no valid position found, return null (don't place Pokemon)
    return null
  }

  const handleGenerate = async () => {
    if (!baseImage || !backgroundMask || !imageRef.current) return
    
    setIsLoading(true)
    try {
      // Generate random number of Pokemon (1-5)
      const numPokemon = Math.floor(Math.random() * 5) + 1
      
      // Get image dimensions
      const imageWidth = imageRef.current.naturalWidth || imageRef.current.width
      const imageHeight = imageRef.current.naturalHeight || imageRef.current.height
      
      const newPokemonList = []
      const existingPokemonForCollision = [] // Track placed Pokemon for collision detection
      
      // Generate and place each Pokemon
      for (let i = 0; i < numPokemon; i++) {
        try {
          // Generate random Pokemon ID between 1-151
          const randomPokemonId = Math.floor(Math.random() * 1024) + 1
          
          // Fetch Pokemon data from PokéAPI
          const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomPokemonId}/`)
          const data = await response.json()
          
          // Get the Pokemon image URL (prefer official artwork, fallback to front default)
          const imageUrl = data.sprites.other?.['official-artwork']?.front_default || 
                           data.sprites.front_default
          
          if (!imageUrl) continue
          
          // Check Pokemon types
          const pokemonTypes = data.types.map(type => type.type.name.toLowerCase())
          const isFlying = pokemonTypes.includes('flying')
          const isDragon = pokemonTypes.includes('dragon')
          
          // Determine vertical constraint based on type
          // ONLY Flying and Dragon can be in top half
          // All other types must be in bottom half
          let verticalConstraint = 'bottom' // Default: bottom half for all non-flying/dragon
          if (isFlying || isDragon) {
            verticalConstraint = 'top' // Flying and Dragon Pokemon in top half only
          }
          
          // Generate random scale 
          const randomScale = Math.random() * 0.4 + 0.2
          
          // Find a position in the background (checking for collisions and type constraints)
          let position = findBackgroundPosition(
            randomScale,
            imageWidth,
            imageHeight,
            backgroundMask.width,
            backgroundMask.height,
            existingPokemonForCollision,
            verticalConstraint
          )
          
          // If no position found, try with smaller scales
          let currentScale = randomScale
          if (!position) {
            for (let scaleAttempt = 0; scaleAttempt < 5; scaleAttempt++) {
              currentScale = currentScale * 0.8 // Reduce scale by 20%
              if (currentScale < 0.05) break // Don't go too small
              
              position = findBackgroundPosition(
                currentScale,
                imageWidth,
                imageHeight,
                backgroundMask.width,
                backgroundMask.height,
                existingPokemonForCollision,
                verticalConstraint
              )
              
              if (position) break // Found valid position
            }
          }
          
          // If we found a valid position, add Pokemon to list
          if (position) {
            const pokemonWidth = imageWidth * currentScale
            const pokemonHeight = imageHeight * currentScale
            
            // Convert to percentage for CSS
            const leftPercent = (position.x / imageWidth) * 100
            const topPercent = (position.y / imageHeight) * 100
            
            // Add to Pokemon list
            newPokemonList.push({
              imageUrl,
              scale: currentScale,
              left: `${leftPercent}%`,
              top: `${topPercent}%`
            })
            
            // Add to collision tracking
            existingPokemonForCollision.push({
              x: position.x,
              y: position.y,
              width: pokemonWidth,
              height: pokemonHeight
            })
          }
        } catch (error) {
          console.error(`Error fetching Pokemon ${i + 1}:`, error)
          // Continue to next Pokemon even if one fails
        }
      }
      
      if (newPokemonList.length > 0) {
        setPokemonList(newPokemonList)
      } else {
        alert('Could not find suitable background areas for any Pokemon. Try adjusting the threshold slider to detect more background areas.')
      }
    } catch (error) {
      console.error('Error generating Pokemon:', error)
      alert('Failed to generate Pokemon. Please try again.')
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
              {showMaskOverlay && backgroundMask && (
                <canvas 
                  ref={maskCanvasRef}
                  className="mask-overlay"
                />
              )}
              {pokemonList.map((pokemon, index) => (
                <img 
                  key={index}
                  src={pokemon.imageUrl} 
                  alt={`Pokemon ${index + 1}`} 
                  className="pokemon-overlay"
                  style={{
                    transform: `scale(${pokemon.scale})`,
                    left: pokemon.left,
                    top: pokemon.top
                  }}
                />
              ))}
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
                  onMouseEnter={() => setShowMaskOverlay(true)}
                  onMouseLeave={() => setShowMaskOverlay(false)}
                  onFocus={() => setShowMaskOverlay(true)}
                  onBlur={() => setShowMaskOverlay(false)}
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
