// Resend 6.37.0 refers to a global HeadersInit that Node's types do not export.
// Use Node's existing fetch header type without enabling browser DOM globals.
declare global {
  type HeadersInit = NonNullable<RequestInit['headers']>;
}

export {};
