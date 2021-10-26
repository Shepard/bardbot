export default class RandomMessageProvider {
	#registry = [];

	add(messageCreator) {
		this.#registry.push(messageCreator);
		return this;
	}

	any(...args) {
		const messageCreator = this.#registry[Math.floor(Math.random() * this.#registry.length)];
		return messageCreator(...args);
	}
}