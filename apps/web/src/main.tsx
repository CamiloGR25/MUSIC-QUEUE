import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router'
import { router } from './app/router.tsx'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Falta el elemento #root')

createRoot(root).render(
  <StrictMode>
    {/* Respeta "reducir movimiento" del sistema (docs/DISENO.md §9.4). */}
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  </StrictMode>,
)
