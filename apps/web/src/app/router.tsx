import { createBrowserRouter } from 'react-router'
import { FixedEntryPage } from '../features/guest/fixed-entry-page.tsx'
import { GuestPage } from '../features/guest/guest-page.tsx'
import { HomePage } from '../features/home/home-page.tsx'
import { HostPage } from '../features/host/host-page.tsx'

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/anfitrion', element: <HostPage /> },
  { path: '/s/:code', element: <GuestPage /> },
  { path: '/e/:code', element: <FixedEntryPage /> },
])
