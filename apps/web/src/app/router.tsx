import { createBrowserRouter } from 'react-router'

/**
 * Cada pantalla se descarga solo cuando se abre: el celular del invitado no baja el código del
 * panel del anfitrión (QR, impresión, controles) ni al revés.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    lazy: async () => ({ Component: (await import('../features/home/home-page.tsx')).HomePage }),
  },
  {
    path: '/anfitrion',
    lazy: async () => ({ Component: (await import('../features/host/host-page.tsx')).HostPage }),
  },
  {
    path: '/s/:code',
    lazy: async () => ({
      Component: (await import('../features/guest/guest-page.tsx')).GuestPage,
    }),
  },
  {
    path: '/e/:code',
    lazy: async () => ({
      Component: (await import('../features/guest/fixed-entry-page.tsx')).FixedEntryPage,
    }),
  },
])
