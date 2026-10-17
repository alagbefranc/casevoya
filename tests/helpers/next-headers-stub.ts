export async function cookies() {
  return {
    getAll() {
      return [];
    },
    set() {},
  };
}

export async function headers() {
  return new Headers();
}
