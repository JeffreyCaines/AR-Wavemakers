/// <reference types="vite/client" />

// Fallback ambient declarations so side-effect CSS imports type-check even if
// the vite/client reference above is not picked up by the toolchain.
declare module "*.css" {
  const content: string;
  export default content;
}
