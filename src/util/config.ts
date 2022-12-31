import fsPromises from 'fs/promises';

const config = JSON.parse(await fsPromises.readFile('./config.json', 'utf-8'));
export default config;
