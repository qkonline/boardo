/** Thrown for anything the app should show: the status and a short reason. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
