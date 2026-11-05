import { createRoot } from 'react-dom/client';
import { App } from './app';
import './fonts.css';
const root = document.getElementById('root');
if (!root) throw new Error('The workspace root element is missing.');
createRoot(root).render(<App />);
