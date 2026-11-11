import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.tsx'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Falta el elemento #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
