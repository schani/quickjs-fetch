import { getQuickJS, QuickJSDeferredPromise, QuickJSWASMModule, Scope } from "quickjs-emscripten";
import fetch from "node-fetch";

const code = `
(async function () {
const res = await fetch(
  "https://ghibliapi.herokuapp.com/films"
);
if (!res.ok) return;
const films = await res.json();
return films[Math.floor(Math.random() * films.length)];
})()
`;

const preamble = `
this.__responsePrototype = {
  async json() {
    return JSON.parse(await this.text());
  }
}
`;

async function test(quickJS: QuickJSWASMModule): Promise<void> {
  await Scope.withScopeAsync(async scope => {
    const vm = scope.manage(quickJS.newContext());
    scope.manage(vm.unwrapResult(vm.evalCode(preamble)));

    const responseClass = scope.manage(vm.getProp(vm.global, "__responsePrototype"));

    const fetchFN = scope.manage(vm.newFunction("fetch", (urlHandle) => {
      const url = vm.getString(urlHandle);
      // urlHandle.dispose();
      console.log("fetch", url);
      // return vm.newNumber(123);
      const qjsPromise = scope.manage(vm.newPromise());
      fetch(url).then(res => {
        if (!vm.alive) return;
        if (res === undefined) {
          qjsPromise.resolve(vm.undefined);
          return;
        }
        const obj = scope.manage(vm.newObject(responseClass));
        vm.setProp(obj, "ok", res.ok ? vm.true : vm.false);

        const textFN = scope.manage(vm.newFunction("text", () => {
          const qjsTextPromise = scope.manage(vm.newPromise());
          res.text().then(str => {
            if (!vm.alive) return;
            qjsTextPromise.resolve(scope.manage(vm.newString(str)));
          }).catch(_e => {
            if (!vm.alive) return;
            qjsTextPromise.reject(scope.manage(vm.newError("Error")));
          });
          qjsTextPromise.settled.then(vm.runtime.executePendingJobs);
          return qjsTextPromise.handle;
        }));
        vm.setProp(obj, "text", textFN);
        qjsPromise.resolve(obj);
      }).catch(_e => {
        if (!vm.alive) return;
        qjsPromise.reject(scope.manage(vm.newError("Error")));
      });
      qjsPromise.settled.then(vm.runtime.executePendingJobs);
      return qjsPromise.handle;
    }));
    vm.setProp(vm.global, "fetch", fetchFN);

    // const result = vm.evalCode(`Object.getOwnPropertyNames(this).join(",")`)
    const result = vm.evalCode(code);

    const resultHandle = scope.manage(vm.unwrapResult(result));

    console.log("result", vm.dump(resultHandle), vm.typeof(resultHandle));

    const resolvedResult = await vm.resolvePromise(resultHandle);

    const resolvedHandle = scope.manage(vm.unwrapResult(resolvedResult));

    console.log("resolved result", vm.dump(resolvedHandle));
  })

  // if (result.error) {
  //   console.log("Execution failed:", vm.dump(result.error))
  //   result.error.dispose();
  // } else {
  //   console.log("Success:", vm.dump(result.value))
  //   result.value.dispose();
  // }
}

async function main() {
  const QuickJS = await getQuickJS();

  for (let i = 0; i < 1; i++) {
    try {
      await test(QuickJS);
    } catch (e: unknown) {
      console.error(e);
    }
  }

  console.log("done");
}

main()
