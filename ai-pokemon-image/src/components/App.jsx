import { useState, useRef } from 'react'
import '../styles/App.css'

function App() {
  const [selectedImage, setSelectedImage] = useState(null)
  const fileInputRef = useRef(null)

  const handleImageSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      const imageUrl = URL.createObjectURL(file)
      setSelectedImage(imageUrl)
    }
  }

  const handleButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleBack = () => {
    if (selectedImage) {
      URL.revokeObjectURL(selectedImage)
      setSelectedImage(null)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleGenerate = () => {
    // Placeholder for generate functionality
    console.log('Generate button clicked')
  }

  return (
    <>
      <div className="app-container">
        <h1>Image Selector</h1>
        {!selectedImage ? (
          <button onClick={handleButtonClick} className="select-button">
            Select Image
          </button>
        ) : (
          <>
            <div className="image-container">
              <img src={selectedImage} alt="Selected" className="selected-image" />
            </div>
            <div className="button-group">
              <button onClick={handleBack} className="back-button">
                Back
              </button>
              <button onClick={handleGenerate} className="generate-button">
                Generate
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
