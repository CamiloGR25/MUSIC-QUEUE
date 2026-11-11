import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router.tsx'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Falta el elemento #root')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
