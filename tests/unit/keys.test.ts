import { describe, expect, it } from 'vitest'

// comboFromEvent lives in the renderer; it only needs a KeyboardEvent-like object.
describe('keyboard combos across platforms and layouts', async () => {
  const { comboFromEvent, defaultHotkeys } = await import('../../src/renderer/src/state/commands')
  const ev = (o: Partial<KeyboardEvent>): KeyboardEvent => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: '', code: '', ...o }) as KeyboardEvent
  it('maps Cmd to Ctrl and keeps layout letters', () => {
    expect(comboFromEvent(ev({ metaKey: true, key: 'c', code: 'KeyC' }))).toBe('Ctrl+C')
    // German QWERTZ: the key labelled Z has code KeyY; the labelled letter must win.
    expect(comboFromEvent(ev({ ctrlKey: true, key: 'z', code: 'KeyY' }))).toBe('Ctrl+Z')
  })
  it('uses the physical key for macOS Option compositions', () => {
    expect(comboFromEvent(ev({ altKey: true, key: '∂', code: 'KeyD' }))).toBe('Alt+D')
    // Real keyboards report the shifted symbol for Shift+digit: the shortcut must still be Ctrl+Shift+<digit>.
    expect(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' }))).toBe('Ctrl+Shift+1')
    expect(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: '=', code: 'Digit0' }))).toBe('Ctrl+Shift+0')
    expect(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: '%', code: 'Digit5' }))).toBe('Ctrl+Shift+5')
    // AZERTY: the unshifted digit row types "&", "é"…
    expect(comboFromEvent(ev({ ctrlKey: true, key: '&', code: 'Digit1' }))).toBe('Ctrl+1')
    // Without a modifier the typed character is kept (type-ahead find).
    expect(comboFromEvent(ev({ shiftKey: true, key: '!', code: 'Digit1' }))).toBe('!')
    expect(comboFromEvent(ev({ metaKey: true, altKey: true, key: '¡', code: 'Digit1' }))).toBe('Ctrl+Alt+1')
  })
  it('treats Shift as implicit for symbols without modifiers', () => {
    expect(comboFromEvent(ev({ shiftKey: true, key: '+', code: 'Equal' }))).toBe('+')
    expect(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: 'Tab', code: 'Tab' }))).toBe('Ctrl+Shift+Tab')
  })
  it('applies macOS overrides only on darwin', () => {
    const mac = defaultHotkeys('standard', 'darwin')
    const win = defaultHotkeys('standard', 'win32')
    expect(mac['Ctrl+Backspace']).toBe('Delete')
    expect(win['Ctrl+Backspace']).toBe('Go ROOT')
    expect(mac['Ctrl+H']).toBeUndefined()
    expect(mac['Ctrl+Shift+5']).toBeUndefined()
    expect(mac['Ctrl+Alt+3']).toBe('Set VIEW=columns')
    expect(win['Ctrl+Shift+5']).toBe('Set VIEW=columns')
    expect(defaultHotkeys('commander', 'darwin')['Ctrl+Backspace']).toBe('Delete')
  })
})
