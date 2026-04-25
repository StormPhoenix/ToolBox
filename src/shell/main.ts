import { createApp } from 'vue';
import App from './App.vue';
import './styles/global.css';
import { initTheme } from './composables/useTheme';

initTheme();
createApp(App).mount('#app');
