export class PageNotFound extends Error {
  constructor(id: string) {
    super(`There’s no page “${id}”. It may have been moved to the trash.`);
    this.name = 'PageNotFound';
  }
}
