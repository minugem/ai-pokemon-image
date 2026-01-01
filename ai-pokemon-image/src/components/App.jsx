import { useState, useRef, useEffect } from 'react'
import '../styles/App.css'

function App() {
  const [baseImage, setBaseImage] = useState(null)
  const [baseImageFile, setBaseImageFile] = useState(null)
  const [backgroundMask, setBackgroundMask] = useState(null) // Combined background mask
  const [subjectMask, setSubjectMask] = useState(null) // Subject mask
  const [skyMask, setSkyMask] = useState(null) // Sky mask
  const [groundMask, setGroundMask] = useState(null) // Ground mask
  const [otherMask, setOtherMask] = useState(null) // Other background mask
  const [originalImageData, setOriginalImageData] = useState(null) // Store original processed image data
  const [pokemonList, setPokemonList] = useState([]) // Array of {imageUrl, scale, left, top}
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessingBackground, setIsProcessingBackground] = useState(false)
  const [backgroundThreshold, setBackgroundThreshold] = useState(0.5)
  const [showMaskOverlay, setShowMaskOverlay] = useState(false)
  const fileInputRef = useRef(null)
  const imageRef = useRef(null)
  const maskCanvasRef = useRef(null)
  
  // SAM API endpoint - defaults to localhost:5001, can be overridden with env variable
  const SAM_API_URL = import.meta.env.VITE_SAM_API_URL || 'http://localhost:5001'
  const SEGMENT_API_URL = `${SAM_API_URL}/segment`
  const REMOVE_BG_API_URL = `${SAM_API_URL}/remove-background`

  const handleImageSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      const imageUrl = URL.createObjectURL(file)
      setBaseImage(imageUrl)
      setBaseImageFile(file)
      // Clear Pokemon overlay when new image is selected
      setPokemonList([])
      setBackgroundMask(null)
      setSubjectMask(null)
      setSkyMask(null)
      setGroundMask(null)
      setOtherMask(null)
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

        // Call SAM segment API to get segmentation mask
        const formData = new FormData()
        formData.append('image', baseImageFile)

        const response = await fetch(SEGMENT_API_URL, {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          throw new Error(`API error: ${response.status} - ${errorText}`)
        }

        const blob = await response.blob()
        
        if (!blob || blob.size === 0) {
          throw new Error('Segmentation returned empty result')
        }

        // Create canvas to get mask data from the result
        // Segmentation returns colored mask: red=subject, blue=sky, green=ground, yellow=other
        const img = new Image()
        const blobUrl = URL.createObjectURL(blob)
        img.src = blobUrl
        
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          setTimeout(() => reject(new Error('Segmentation image load timeout')), 10000)
        })

        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          throw new Error('Could not get canvas context')
        }
        
        ctx.drawImage(img, 0, 0)

        // Get image data from segmentation result
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        
        // Store original image data for threshold recalculation
        setOriginalImageData({
          data: new Uint8ClampedArray(imageData.data),
          width: canvas.width,
          height: canvas.height
        })

        // Process segmentation mask to extract 4 separate masks
        // Backend sends: Magenta (255, 0, 255) = subject, Cyan (0, 255, 255) = sky, Orange (255, 165, 0) = ground, Yellow (255, 255, 0) = other
        const subject = new Uint8Array(imageData.data.length / 4)
        const sky = new Uint8Array(imageData.data.length / 4)
        const ground = new Uint8Array(imageData.data.length / 4)
        const other = new Uint8Array(imageData.data.length / 4)
        const combinedBackground = new Uint8Array(imageData.data.length / 4)
        
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i]
          const g = imageData.data[i + 1]
          const b = imageData.data[i + 2]
          
          // Determine class based on backend colors
          // Magenta: high R and B, low G (subject)
          if (r > 200 && b > 200 && g < 100) {
            subject[i / 4] = 1
            sky[i / 4] = 0
            ground[i / 4] = 0
            other[i / 4] = 0
            combinedBackground[i / 4] = 0
          } 
          // Cyan: high G and B, low R (sky)
          else if (g > 200 && b > 200 && r < 100) {
            sky[i / 4] = 1
            subject[i / 4] = 0
            ground[i / 4] = 0
            other[i / 4] = 0
            combinedBackground[i / 4] = 1
          } 
          // Orange: high R, medium G (around 165), low B (ground)
          else if (r > 200 && g > 140 && g < 190 && b < 50) {
            ground[i / 4] = 1
            subject[i / 4] = 0
            sky[i / 4] = 0
            other[i / 4] = 0
            combinedBackground[i / 4] = 1
          } 
          // Yellow: high R and G, low B (other)
          else if (r > 200 && g > 200 && b < 100) {
            other[i / 4] = 1
            subject[i / 4] = 0
            sky[i / 4] = 0
            ground[i / 4] = 0
            combinedBackground[i / 4] = 1
          } else {
            // Re-classify based on actual image colors with threshold
            const brightness = (r + g + b) / 3
            const saturation = Math.max(r, g, b) - Math.min(r, g, b)
            
            // Threshold affects detection sensitivity
            const skyBrightnessThreshold = 90 + (1 - backgroundThreshold) * 40  // 90-130 (more lenient)
            const skyBlueThreshold = 90 + (1 - backgroundThreshold) * 30  // 90-120 (more lenient)
            const groundGreenThreshold = 100 - (1 - backgroundThreshold) * 20
            const groundBrightnessThreshold = 200 + (1 - backgroundThreshold) * 30
            
            // Sky detection - more lenient, check FIRST
            const is_sky_like = (
              brightness > skyBrightnessThreshold &&
              b > skyBlueThreshold &&
              (b > r || b > g) &&  // Blue is at least equal to or higher than one other component
              (b > r + 10 || b > g + 10) &&  // Blue is somewhat dominant
              saturation < 160  // Not too colorful
            )
            
            // Ground detection - explicitly exclude blue-dominant pixels
            const is_green_dominant = g > r + 20 && g > b + 20
            const is_brownish = r > 100 && g > 80 && b < 100 && Math.abs(r - g) < 30
            
            const is_ground_like = (
              !is_sky_like &&  // NOT sky
              b < 100 &&  // Blue is LOW (critical for separating from sky)
              (
                (is_green_dominant && g > groundGreenThreshold && brightness < groundBrightnessThreshold) ||
                (is_brownish && brightness < 200) ||
                (g > 90 && r > 70 && b < 90 && brightness < 210 && b < r && b < g) ||
                (r > 80 && g > 70 && b < 80 && brightness < 190)
              )
            )
            
            // Sky takes priority
            if (is_sky_like) {
              sky[i / 4] = 1
              ground[i / 4] = 0
              other[i / 4] = 0
              combinedBackground[i / 4] = 1
            } else if (is_ground_like) {
              sky[i / 4] = 0
              ground[i / 4] = 1
              other[i / 4] = 0
              combinedBackground[i / 4] = 1
            } else {
              sky[i / 4] = 0
              ground[i / 4] = 0
              other[i / 4] = 1
              combinedBackground[i / 4] = 1
            }
            subject[i / 4] = 0
          }
        }

        // Clean up blob URL
        URL.revokeObjectURL(blobUrl)

        setSubjectMask({
          data: subject,
          width: canvas.width,
          height: canvas.height
        })
        
        setSkyMask({
          data: sky,
          width: canvas.width,
          height: canvas.height
        })
        
        setGroundMask({
          data: ground,
          width: canvas.width,
          height: canvas.height
        })
        
        setOtherMask({
          data: other,
          width: canvas.width,
          height: canvas.height
        })
        
        setBackgroundMask({
          data: combinedBackground,
          width: canvas.width,
          height: canvas.height
        })
      } catch (error) {
        console.error('Error processing background:', error)
        alert(`Failed to process background: ${error.message || 'Unknown error'}. Make sure your SAM backend server is running at ${SAM_API_URL}`)
        setIsProcessingBackground(false)
      } finally {
        setIsProcessingBackground(false)
      }
    }

    if (baseImageFile && imageRef.current) {
      // Always process when baseImageFile changes (new image selected)
      processBackground()
    }
  }, [baseImageFile, SEGMENT_API_URL])

  // Recalculate masks when threshold changes (without calling API)
  useEffect(() => {
    if (!originalImageData) return

    const subject = new Uint8Array(originalImageData.data.length / 4)
    const sky = new Uint8Array(originalImageData.data.length / 4)
    const ground = new Uint8Array(originalImageData.data.length / 4)
    const other = new Uint8Array(originalImageData.data.length / 4)
    const combinedBackground = new Uint8Array(originalImageData.data.length / 4)
    
    for (let i = 0; i < originalImageData.data.length; i += 4) {
      const r = originalImageData.data[i]
      const g = originalImageData.data[i + 1]
      const b = originalImageData.data[i + 2]
      
      // Determine class based on distinct colors
      // Magenta: high R and B, low G
      if (r > 200 && b > 200 && g < 100) {
        // Subject (magenta)
        subject[i / 4] = 1
        sky[i / 4] = 0
        ground[i / 4] = 0
        other[i / 4] = 0
        combinedBackground[i / 4] = 0
      } 
      // Cyan: high G and B, low R
      else if (g > 200 && b > 200 && r < 100) {
        // Sky (cyan)
        subject[i / 4] = 0
        sky[i / 4] = 1
        ground[i / 4] = 0
        other[i / 4] = 0
        combinedBackground[i / 4] = 1
      } 
      // Orange: high R, medium G, low B
      else if (r > 200 && g > 100 && g < 200 && b < 100) {
        // Ground (orange)
        subject[i / 4] = 0
        sky[i / 4] = 0
        ground[i / 4] = 1
        other[i / 4] = 0
        combinedBackground[i / 4] = 1
      } 
      // Yellow: high R and G, low B
      else if (r > 200 && g > 200 && b < 100) {
        // Other (yellow)
        subject[i / 4] = 0
        sky[i / 4] = 0
        ground[i / 4] = 0
        other[i / 4] = 1
        combinedBackground[i / 4] = 1
      } else {
        // Re-classify based on color characteristics with threshold adjustment
        const brightness = (r + g + b) / 3
        const saturation = Math.max(r, g, b) - Math.min(r, g, b)
        
        // Threshold affects detection sensitivity
        // Lower threshold = more sensitive (detects more sky/ground)
        // Higher threshold = less sensitive (detects less sky/ground)
        const skyBrightnessThreshold = 120 + (1 - backgroundThreshold) * 40  // 120-160
        const skyBlueThreshold = 130 + (1 - backgroundThreshold) * 30  // 130-160
        const groundGreenThreshold = 100 - (1 - backgroundThreshold) * 20  // 80-100
        const groundBrightnessThreshold = 200 + (1 - backgroundThreshold) * 30  // 200-230
        
        // Sky detection with threshold - check FIRST, sky takes priority
        // Very lenient sky detection - prioritize detecting sky correctly
        const is_sky_like = (
          brightness > (skyBrightnessThreshold - 50) &&  // Very lenient brightness (70-110)
          b > (skyBlueThreshold - 50) &&  // Very lenient blue (80-110)
          (b >= r || b >= g) &&  // Blue is at least equal to or higher than one other component
          (b > r + 5 || b > g + 5) &&  // Blue is somewhat dominant (very lenient)
          saturation < 180  // Not too colorful (very lenient)
        )
        
        // Ground detection with threshold - explicitly exclude sky-like pixels
        // CRITICAL: Blue must be LOW to be ground
        const is_green_dominant = g > r + 20 && g > b + 20
        const is_brownish = r > 100 && g > 80 && b < 100 && Math.abs(r - g) < 30
        
        const is_ground_like = (
          !is_sky_like &&  // NOT sky - this prevents sky from being classified as ground
          b < 90 &&  // Blue is LOW (critical for separating from sky - lowered threshold)
          (
            (is_green_dominant && g > groundGreenThreshold && brightness < groundBrightnessThreshold) ||  // Grass
            (is_brownish && brightness < 200) ||  // Brown
            (g > 90 && r > 70 && b < 80 && brightness < 210 && b < r && b < g) ||  // Earth tones (blue is lowest)
            (r > 80 && g > 70 && b < 70 && brightness < 190)  // Darker earth tones (very low blue)
          )
        )
        
        // Sky takes priority - check sky first
        if (is_sky_like) {
          sky[i / 4] = 1
          ground[i / 4] = 0
          other[i / 4] = 0
          combinedBackground[i / 4] = 1
        } else if (is_ground_like) {
          sky[i / 4] = 0
          ground[i / 4] = 1
          other[i / 4] = 0
          combinedBackground[i / 4] = 1
        } else {
          // Other background
          sky[i / 4] = 0
          ground[i / 4] = 0
          other[i / 4] = 1
          combinedBackground[i / 4] = 1
        }
        subject[i / 4] = 0
      }
    }

    setSubjectMask({
      data: subject,
      width: originalImageData.width,
      height: originalImageData.height
    })
    
    setSkyMask({
      data: sky,
      width: originalImageData.width,
      height: originalImageData.height
    })
    
    setGroundMask({
      data: ground,
      width: originalImageData.width,
      height: originalImageData.height
    })
    
    setOtherMask({
      data: other,
      width: originalImageData.width,
      height: originalImageData.height
    })
    
    setBackgroundMask({
      data: combinedBackground,
      width: originalImageData.width,
      height: originalImageData.height
    })
  }, [backgroundThreshold, originalImageData])

  // Update mask overlay visualization with different colors for each category
  useEffect(() => {
    if (!backgroundMask || !subjectMask || !skyMask || !groundMask || !otherMask || !maskCanvasRef.current || !imageRef.current || !showMaskOverlay) return

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
          
          // Check each category
          const isSubject = subjectMask.data[maskIndex] === 1
          const isSky = skyMask.data[maskIndex] === 1
          const isGround = groundMask.data[maskIndex] === 1
          const isOther = otherMask.data[maskIndex] === 1
          
          const pixelIndex = (y * canvas.width + x) * 4
          
          if (isSubject) {
            // Subject = bright magenta/pink overlay
            imageData.data[pixelIndex] = 255      // R
            imageData.data[pixelIndex + 1] = 0    // G
            imageData.data[pixelIndex + 2] = 255  // B (magenta)
            imageData.data[pixelIndex + 3] = 150  // Alpha (more visible)
          } else if (isSky) {
            // Sky = bright cyan overlay
            imageData.data[pixelIndex] = 0        // R
            imageData.data[pixelIndex + 1] = 255  // G
            imageData.data[pixelIndex + 2] = 255  // B (cyan)
            imageData.data[pixelIndex + 3] = 150  // Alpha (more visible)
          } else if (isGround) {
            // Ground = bright orange overlay
            imageData.data[pixelIndex] = 255      // R
            imageData.data[pixelIndex + 1] = 165  // G
            imageData.data[pixelIndex + 2] = 0    // B (orange)
            imageData.data[pixelIndex + 3] = 150  // Alpha (more visible)
          } else if (isOther) {
            // Other = bright yellow overlay
            imageData.data[pixelIndex] = 255      // R
            imageData.data[pixelIndex + 1] = 255  // G
            imageData.data[pixelIndex + 2] = 0  // B (yellow)
            imageData.data[pixelIndex + 3] = 150  // Alpha (more visible)
          } else {
            // No overlay
            imageData.data[pixelIndex] = 0
            imageData.data[pixelIndex + 1] = 0
            imageData.data[pixelIndex + 2] = 0
            imageData.data[pixelIndex + 3] = 0
          }
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0)
  }, [backgroundMask, subjectMask, skyMask, groundMask, otherMask, backgroundThreshold, showMaskOverlay])

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
    setSubjectMask(null)
    setSkyMask(null)
    setGroundMask(null)
    setOtherMask(null)
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

  const findBackgroundPosition = (scale, imageWidth, imageHeight, maskWidth, maskHeight, existingPokemon = []) => {
    const pokemonWidth = imageWidth * scale
    const pokemonHeight = imageHeight * scale
    
    // Scale mask coordinates to image coordinates
    const scaleX = imageWidth / maskWidth
    const scaleY = imageHeight / maskHeight
    
    // Check if Pokemon fits in image
    const maxX = imageWidth - pokemonWidth
    const maxY = imageHeight - pokemonHeight
    const minY = 0
    
    if (maxX <= 0 || maxY <= 0) {
      // Pokemon too large
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
      const randomY = Math.random() * maxY
      
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
          
          // Generate random scale 
          const randomScale = Math.random() * 0.4 + 0.2
          
          // Find a position in the background (checking for collisions)
          let position = findBackgroundPosition(
            randomScale,
            imageWidth,
            imageHeight,
            backgroundMask.width,
            backgroundMask.height,
            existingPokemonForCollision
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
                existingPokemonForCollision
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
                Processing background with SAM (detecting subject, sky, ground, and other)... This may take a moment.
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
