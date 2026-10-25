export interface UpdateNotice {
  available: boolean;
  error: string;
}

export function withUpdateTimeout<T>(
  task: Promise<T>,
  message: string,
  timeout = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    task.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function askUpdateWorker(worker: ServiceWorker, type: string) {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("更新程序未响应，当前页面已保留，请稍后重试。")),
      10_000,
    );
    channel.port1.onmessage = (event) => {
      if (event.data?.ok === true) finish();
      else finish(new Error(event.data?.error || "更新检查失败，请稍后重试。"));
    };
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** No controllerchange or updatefound event may reload an editing page. */
export function watchPwaUpdates(
  container: ServiceWorkerContainer,
  base: URL,
  notify: (notice: UpdateNotice) => void,
) {
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let available = false;
  let initialController = container.controller;
  let lastCheck = 0;
  let checking = false;
  const cleanup: Array<() => void> = [];
  const emit = (error = "") => {
    if (!disposed) notify({ available, error });
  };
  const discover = () => {
    if (registration?.waiting && registration.active) {
      available = true;
      emit();
    }
  };
  const watchInstalling = () => {
    const worker = registration?.installing;
    if (!worker) return;
    const changed = () => {
      discover();
      if (worker.state === "redundant")
        emit("新版本安装失败，当前版本仍可使用，请联网后重试。");
    };
    worker.addEventListener("statechange", changed);
    cleanup.push(() => worker.removeEventListener("statechange", changed));
  };
  const controllerChanged = () => {
    if (initialController && container.controller !== initialController) {
      available = true;
      emit();
    }
    initialController = container.controller;
  };
  container.addEventListener("controllerchange", controllerChanged);
  const register = () =>
    container
      .register(new URL("sw.js", base).href, {
        scope: base.href,
        updateViaCache: "none",
      })
      .then((value) => {
        registration = value;
        if (disposed) return;
        value.addEventListener("updatefound", watchInstalling);
        cleanup.push(() =>
          value.removeEventListener("updatefound", watchInstalling),
        );
        watchInstalling();
        discover();
      })
      .catch((error: unknown) => {
        emit(
          `无法检查更新：${error instanceof Error ? error.message : String(error)}`,
        );
      });
  let ready = register();

  return {
    async check(force = false) {
      await ready;
      if (!registration && force) {
        ready = register();
        await ready;
      }
      if (disposed || !registration || checking) return;
      if (!force && Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      checking = true;
      try {
        await registration.update();
        discover();
        emit();
      } catch {
        emit("检查更新失败，请确认网络连接后重试；当前内容仍保留。");
      } finally {
        checking = false;
      }
    },
    async prepare(allowReload = false) {
      await ready;
      const worker = registration?.waiting;
      if (worker) await askUpdateWorker(worker, "RADISHINK_CHECK_UPDATE");
      else if (!available && !allowReload)
        throw new Error("新版本尚未准备好，请稍后重试。");
      return worker;
    },
    async activate(worker: ServiceWorker | null | undefined) {
      if (!worker) return; // Another page already activated; this page still requires consent/save.
      if (worker.state !== "activated") {
        if (registration?.waiting !== worker)
          throw new Error("待更新版本已变化，请重试。");
        await askUpdateWorker(worker, "RADISHINK_ACTIVATE_UPDATE");
      }
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
          clearTimeout(timer);
          worker.removeEventListener("statechange", changed);
          container.removeEventListener("controllerchange", changed);
          if (error) reject(error);
          else resolve();
        };
        const changed = () => {
          if (worker.state === "activated" && container.controller === worker)
            done();
          else if (worker.state === "redundant")
            done(new Error("更新已失效，请重试。"));
        };
        const timer = setTimeout(
          () => done(new Error("接管更新超时；当前输入已保留，请重试。")),
          15_000,
        );
        worker.addEventListener("statechange", changed);
        container.addEventListener("controllerchange", changed);
        changed();
      });
    },
    dispose() {
      disposed = true;
      cleanup.forEach((remove) => remove());
      container.removeEventListener("controllerchange", controllerChanged);
    },
  };
}
