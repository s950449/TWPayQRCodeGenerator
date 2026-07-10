export class LatestOperation {
  #current = 0;

  start() {
    this.#current += 1;
    return this.#current;
  }

  invalidate() {
    this.#current += 1;
  }

  isCurrent(id) {
    return id === this.#current;
  }
}
