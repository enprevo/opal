import type { OpalApi } from '../../preload'

declare global {
  interface Window {
    opal: OpalApi
  }
}

export {}
