import { useState, useRef } from 'react'
import '../styles/App.css'

function App() {
  const [baseImage, setBaseImage] = useState(null)
  const [pokemonImage, setPokemonImage] = useState(null)
  const [pokemonStyle, setPokemonStyle] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef(null)

  const handleImageSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      const imageUrl = URL.createObjectURL(file)
      setBaseImage(imageUrl)
      // Clear Pokemon overlay when new image is selected
      setPokemonImage(null)
      setPokemonStyle(null)
    }
  }

  const handleButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleBack = () => {
    if (baseImage && baseImage.startsWith('blob:')) {
      URL.revokeObjectURL(baseImage)
    }
    setBaseImage(null)
    setPokemonImage(null)
    setPokemonStyle(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleGenerate = async () => {
    if (!baseImage) return
    
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
      
      if (imageUrl) {
        // Generate random scale between 0.0 and 0.9
        const randomScale = Math.random() * 0.9
        
        // Generate random position (0% to 100% for both x and y)
        // Position is calculated so the Pokemon stays within bounds
        const maxPosition = 100 - (randomScale * 100)
        const randomX = Math.random() * maxPosition
        const randomY = Math.random() * maxPosition
        
        setPokemonImage(imageUrl)
        setPokemonStyle({
          scale: randomScale,
          left: `${randomX}%`,
          top: `${randomY}%`
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
        <h1>Image Selector</h1>
        {!baseImage ? (
          <button onClick={handleButtonClick} className="select-button">
            Select Image
          </button>
        ) : (
          <>
            <div className="image-container">
              <img src={baseImage} alt="Selected" className="selected-image" />
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
            <div className="button-group">
              <button onClick={handleBack} className="back-button">
                Back
              </button>
              <button 
                onClick={handleGenerate} 
                className="generate-button"
                disabled={isLoading}
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
