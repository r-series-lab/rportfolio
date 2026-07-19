export function createDeferredModuleLoader<Key extends PropertyKey, Module>(
  loaders: Record<Key, () => Promise<Module>>,
) {
  const pendingModules = new Map<Key, Promise<Module>>();

  return (key: Key): Promise<Module> => {
    const existing = pendingModules.get(key);
    if (existing) return existing;

    const pending = loaders[key]();
    pendingModules.set(key, pending);
    void pending.catch(() => {
      if (pendingModules.get(key) === pending) pendingModules.delete(key);
    });
    return pending;
  };
}
