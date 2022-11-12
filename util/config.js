import fsPromises from 'fs/promises';

const config = JSON.parse(await fsPromises.readFile('./config.json'));
export default config;
