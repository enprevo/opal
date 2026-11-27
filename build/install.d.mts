export function linuxTarget(has: (cmd: string) => boolean, appImage?: boolean): 'deb' | 'rpm' | 'AppImage'
export function findPackage(files: string[], ext: string): string | undefined
export function nodeIsRecent(version: string): boolean
export function sizeOf(p: string): number
export function formatSize(bytes: number): string
