import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrap } from './state/actions'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
void bootstrap()
