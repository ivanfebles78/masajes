// Información pública del salón, pedida una sola vez y compartida por la
// reserva y la tienda.
import { api } from './comun.js';

export const infoLista = api('/api/info');
