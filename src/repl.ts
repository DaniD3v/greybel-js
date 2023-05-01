import { editor } from '@inquirer/prompts';
import { init as initGHIntrinsics } from 'greybel-gh-mock-intrinsics';
import {
  CustomFunction,
  CustomString,
  CustomValue,
  DefaultType,
  HandlerContainer,
  Interpreter,
  ObjectValue,
  ObjectValue as ObjectValueType,
  OperationContext,
  PrepareError,
  RuntimeError
} from 'greybel-interpreter';
import { init as initIntrinsics } from 'greybel-intrinsics';

import CLIOutputHandler, { useColor } from './execute/output.js';
import GrebyelPseudoDebugger from './repl/debugger.js';

export interface REPLOptions {
  api?: ObjectValueType;
}

export default async function repl(
  options: REPLOptions = {}
): Promise<boolean> {
  const vsAPI = options.api || new ObjectValue();
  let active = true;

  vsAPI.set(
    new CustomString('exit'),
    CustomFunction.createExternal(
      'exit',
      (
        ctx: OperationContext,
        _self: CustomValue,
        args: Map<string, CustomValue>
      ): Promise<CustomValue> => {
        ctx.handler.outputHandler.print(args.get('value')!.toString());
        active = false;
        return Promise.resolve(DefaultType.Void);
      }
    ).addArgument('value')
  );

  const interpreter = new Interpreter({
    debugger: new GrebyelPseudoDebugger(),
    handler: new HandlerContainer({
      outputHandler: new CLIOutputHandler()
    }),
    api: initIntrinsics(initGHIntrinsics(vsAPI))
  });

  try {
    /* eslint-disable-next-line no-unmodified-loop-condition */
    while (active) {
      const code = await editor({
        message: '>'
      });

      if (code === '') continue;

      const outputGroupLabel = useColor('cyan', `Execution:`);

      console.group(outputGroupLabel);

      try {
        await interpreter.run(code);
      } catch (err: any) {
        if (err instanceof PrepareError) {
          console.error(
            useColor('red', `${err.message} in ${err.relatedTarget}`)
          );
        } else if (err instanceof RuntimeError) {
          console.error(
            useColor(
              'red',
              `${err.message} in ${err.relatedTarget}\n${err.stack}`
            )
          );
        } else {
          console.error(
            useColor('red', `Unexpected error: ${err.message}\n${err.stack}`)
          );
        }
      }

      console.groupEnd();
    }
  } catch (err: any) {
    console.error(err);

    return false;
  }

  return true;
}
