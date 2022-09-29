import monacoLoader from '@monaco-editor/loader';
import {
  CustomList,
  CustomMap,
  CustomValue,
  Debugger,
  Interpreter,
  OperationContext
} from 'greybel-interpreter';
import Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import React, { useEffect, useRef, useState } from 'react';

import execute from './execute';
import { activate } from './extension';
import language from './extension/grammar/language';
import documentParseQueue from './extension/helper/model-manager';
import viewJSON from './json-viewer';
import minify from './minify';
import { Stdin, Stdout } from './std';

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

function guid() {
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

interface TranspileOptions {
  model: Monaco.editor.ITextModel;
  onShare: () => void;
  showError: (msg: string, timeout?: number) => void;
}

function Transpile({ showError, model, onShare }: TranspileOptions) {
  const [content, setContent] = useState('');
  const [buildType, setBuildType] = useState('0');
  const [obfuscation, setObfuscation] = useState(false);
  const [disableLO, setDisableLO] = useState(false);
  const [disableNO, setDisableNO] = useState(false);
  const [excludedNamespaces, setExcludedNamespaces] = useState('');
  const transpile = async () => {
    try {
      const output = await minify(model.getValue(), {
        uglify: buildType === '1',
        beautify: buildType === '2',
        obfuscation,
        disableLiteralsOptimization: disableLO,
        disableNamespacesOptimization: disableNO,
        excludedNamespaces: excludedNamespaces
          .split(',')
          .map(function (v: any) {
            return v.trim();
          })
      });

      setContent(output);
    } catch (err: any) {
      showError(err.message);
    }
  };

  return (
    <div className="editor-transpile">
      <a id="transpile" onClick={() => transpile()}>
        Transpile
      </a>
      <a id="share" onClick={onShare}>
        Share code
      </a>
      <div className="editor-options">
        <ul>
          <li>
            <select
              id="buildType"
              onChange={(ev) => setBuildType(ev.target.value)}
              defaultValue="0"
            >
              <option value="0">Default</option>
              <option value="1">Uglify</option>
              <option value="2">Beautify</option>
            </select>
            <label>Build type</label>
          </li>
          <li onClick={() => setObfuscation(!obfuscation)}>
            <input
              id="obfuscation"
              type="checkbox"
              checked={obfuscation}
              readOnly
            />
            <label>Obfuscation</label>
          </li>
          <li onClick={() => setDisableLO(!disableLO)}>
            <input
              id="disableLiteralsOptimization"
              type="checkbox"
              checked={disableLO}
              readOnly
            />
            <label>Disable literals optimization</label>
          </li>
          <li onClick={() => setDisableNO(!disableNO)}>
            <input
              id="disableNamespacesOptimization"
              type="checkbox"
              checked={disableNO}
              readOnly
            />
            <label>Disable namespaces optimization</label>
          </li>
          <li>
            <label>Exclude namespaces from optimization</label>
            <input
              id="excludedNamespaces"
              type="text"
              onChange={(ev) => setExcludedNamespaces(ev.target.value)}
            />
          </li>
        </ul>
      </div>
      <label>Transpiler output:</label>
      <textarea
        id="toutput"
        className="editor-transpiled-area"
        readOnly
        value={content}
      />
    </div>
  );
}

interface ExecuteOptions {
  model: Monaco.editor.ITextModel;
  showError: (msg: string, timeout?: number) => void;
  instance: Monaco.editor.IStandaloneCodeEditor;
  setDebug: (debugOptions: DebugPopup | undefined) => void;
}

function Execute({ model, showError, instance, setDebug }: ExecuteOptions) {
  const stdoutRef = useRef<HTMLDivElement>(null);
  const stdinRef = useRef<HTMLInputElement>(null);
  const [stdout, setStdout] = useState<Stdout | undefined>(undefined);
  const [stdin, setStdin] = useState<Stdin | undefined>(undefined);
  const [parameters, setParameters] = useState('');
  const [interpreter, setInterpreter] = useState<Interpreter | null>(null);
  const run = () => {
    if (interpreter !== null) return;

    let activeInterpreter: Interpreter | null = null;

    execute(model, {
      stdin,
      stdout,
      params: parameters.split(' ').filter((v) => v !== ''),
      onStart: (interpreter: Interpreter) => {
        activeInterpreter = interpreter;
        setInterpreter(activeInterpreter);
      },
      onEnd: (_interpreter: Interpreter) => {
        setInterpreter(null);
      },
      onError: (err: any) => {
        showError(err.message);
        setInterpreter(null);
      },
      onInteract: (
        dbgr: Debugger,
        context: OperationContext
      ): Promise<void> => {
        let lastActiveLine: Element | undefined;

        return new Promise((resolve, _reject) => {
          setDebug({
            context,
            onContinue: () => {
              dbgr.setBreakpoint(false);
              setDebug(undefined);
              lastActiveLine?.classList.remove('highlight');
              resolve();
            },
            onExecute: async (input: string) => {
              try {
                dbgr.setBreakpoint(false);
                await activeInterpreter?.injectInLastContext(input);
              } catch (err: any) {
                console.error(err);
              } finally {
                dbgr.setBreakpoint(true);
              }
            },
            onNext: () => {
              dbgr.next();
              setDebug(undefined);
              lastActiveLine?.classList.remove('highlight');
              resolve();
            }
          });

          const line =
            activeInterpreter?.globalContext.getLastActive()?.stackItem?.start!
              .line || -1;

          if (line !== -1) {
            lastActiveLine = Array.from(
              document.querySelectorAll(`.line-numbers`)
            ).find((item: Element) => {
              return item.textContent === line.toString();
            });

            lastActiveLine?.classList.add('highlight');
            instance.revealLineInCenter(line);
          }
        });
      }
    });
  };
  const pause = () => {
    if (interpreter === null) return;

    interpreter.debugger.setBreakpoint(true);
  };
  const stop = () => {
    if (interpreter === null) return;

    interpreter.exit();
  };

  useEffect(() => {
    setStdout(new Stdout(stdoutRef.current));
    setStdin(new Stdin(stdinRef.current));
  }, []);

  return (
    <div className="editor-execute">
      <div className="context">
        <label>Execution parameter:</label>
        <input
          id="params"
          type="text"
          onChange={(ev) => setParameters(ev.target.value)}
        />
      </div>
      <div className="actions">
        <a id="execute" onClick={run} className={interpreter ? 'disabled' : ''}>
          Execute
        </a>
        <a
          id="pause"
          onClick={pause}
          className={!interpreter ? 'disabled' : ''}
        >
          Pause
        </a>
        <a id="stop" onClick={stop} className={!interpreter ? 'disabled' : ''}>
          Stop
        </a>
        <a id="clear" onClick={() => stdout?.clear()}>
          Clear
        </a>
      </div>
      <label>Execution output:</label>
      <div
        id="stdout"
        className="editor-console-stdout"
        ref={stdoutRef}
        onClick={() => stdinRef.current?.focus()}
      ></div>
      <input
        id="stdin"
        className="editor-console-stdin"
        type="text"
        disabled
        ref={stdinRef}
      />
    </div>
  );
}

interface ErrorEntry {
  id: string;
  msg: string;
  onClick: () => void;
}

interface ErrorsOptions {
  errors: ErrorEntry[];
}

function ErrorList({ errors }: ErrorsOptions) {
  return (
    <div id="editor-errors">
      {errors.map(({ id, msg, onClick }) => {
        return (
          <div key={id} onClick={() => onClick()}>
            {msg}
          </div>
        );
      })}
    </div>
  );
}

interface DebugReplOptions {
  onExecute: (replInput: string) => void;
  onContinue: () => void;
  onNext: () => void;
}

function DebugReplPopup({ onExecute, onContinue, onNext }: DebugReplOptions) {
  const [replInput, setReplInput] = useState('');

  return (
    <div className="debugger-popup-navigation">
      <div className="debugger-repl-wrapper">
        <input
          type="text"
          className="debugger-repl"
          onChange={(ev) => {
            setReplInput(ev.target.value);
          }}
          value={replInput}
          onKeyUp={(ev) => {
            if (ev.key === 'Enter' || ev.keyCode === 13) {
              onExecute(replInput);
              setReplInput('');
            }
          }}
        />
        <input
          type="button"
          className="debugger-repl-execute"
          value="Execute"
          onClick={() => {
            onExecute(replInput);
            setReplInput('');
          }}
        />
      </div>
      <div className="debugger-actions">
        <input
          type="button"
          className="debugger-continue"
          value="Continue"
          onClick={onContinue}
        />
        <input
          type="button"
          className="debugger-next"
          value="Next"
          onClick={onNext}
        />
      </div>
    </div>
  );
}

function DebugScopePopup({
  operationContext
}: {
  operationContext: OperationContext;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scopes = operationContext
      .lookupAllScopes()
      .map((scope) => scope.locals.scope.value);

    containerRef.current!.appendChild(viewJSON(scopes));
  }, []);

  return (
    <div className="debugger-popup-scope">
      <div ref={containerRef}></div>
    </div>
  );
}

interface DebugPopup {
  context: OperationContext;
  onExecute: (input: string) => void;
  onContinue: () => void;
  onNext: () => void;
}

interface SharePopup {
  content: string;
  active: boolean;
  onClose: () => void;
}

interface EditorPopupsOptions {
  share: SharePopup;
  debug?: DebugPopup;
}

function EditorPopups(options: EditorPopupsOptions) {
  const popups: JSX.Element[] = [];

  if (options.share.active) {
    const { content, onClose } = options.share;

    const url = new URL(location.href);
    let b64Content = '';

    try {
      //prevent none latin1 signs
      const encoded = encodeURIComponent(content);
      b64Content = btoa(encoded);
    } catch (err: any) {
      console.error(err);
    }

    url.searchParams.set('c', b64Content);

    popups.push(
      <div
        key={'share-popup-bg'}
        className="share-popup-bg"
        onClick={onClose}
      ></div>,
      <div key={'share-popup'} className="share-popup">
        <a onClick={onClose}></a>
        <textarea readOnly value={url.toString()} />
      </div>
    );
  }

  if (options.debug) {
    const { context, onExecute, onContinue, onNext } = options.debug;

    popups.push(
      <div key="debugger-popup-bg" className="debugger-popup-bg"></div>,
      <DebugReplPopup
        key="debugger-repl-popup"
        onExecute={onExecute}
        onContinue={onContinue}
        onNext={onNext}
      />,
      <DebugScopePopup key="debugger-scope-popup" operationContext={context} />
    );
  }

  return <div id="editor-popups">{popups}</div>;
}

interface EditorOptions {
  model: Monaco.editor.ITextModel;
  monaco: typeof Monaco;
  onCreate: (instance: Monaco.editor.IStandaloneCodeEditor) => void;
}

function Editor({ monaco, model, onCreate }: EditorOptions) {
  const editorRef = useRef(null);

  useEffect(() => {
    const instance = monaco.editor.create(editorRef.current!, {
      model,
      automaticLayout: true,
      theme: 'vs-dark'
    });

    onCreate(instance);
  }, []);

  return <div className="editor-ide" ref={editorRef}></div>;
}

interface EditorContext {
  instance?: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  monaco: typeof Monaco;
}

export interface AppOptions {
  initContent?: string;
}

const activeErrors: ErrorEntry[] = [];

export default function (options: AppOptions) {
  const [editorContext, setEditorContext] = useState<EditorContext | null>(
    null
  );
  const [errorEntries, setErrorEntries] = useState<ErrorEntry[]>([]);
  const [share, setShare] = useState<boolean>(false);
  const [debug, setDebug] = useState<DebugPopup | undefined>(undefined);

  if (editorContext === null) {
    monacoLoader.init().then((resolvedMonaco: typeof Monaco) => {
      resolvedMonaco.languages.register({ id: 'greyscript' });
      resolvedMonaco.languages.setMonarchTokensProvider('greyscript', language);

      activate(resolvedMonaco);

      const content =
        options.initContent ||
        localStorage.getItem('ide-content') ||
        'print("Hello world")';
      const model = resolvedMonaco.editor.createModel(content, 'greyscript');

      model.onDidChangeContent((_event) => {
        documentParseQueue.update(model);

        try {
          localStorage.setItem('ide-content', model.getValue());
        } catch (err: any) {
          showError(err.message);
        }
      });

      setEditorContext({
        monaco: resolvedMonaco,
        model
      });
    });

    return <div>Loading</div>;
  }

  const removeError = (id: string) => {
    const index = activeErrors.findIndex((entry) => id === entry.id);

    if (index !== -1) {
      activeErrors.splice(index, 1);
      setErrorEntries([...activeErrors]);
    }
  };
  const showError = (msg: string, timeout: number = 10000) => {
    const id = guid();
    const remove = () => {
      clearTimeout(timer);
      removeError(id);
    };

    activeErrors.push({
      id,
      msg,
      onClick: remove
    });
    setErrorEntries([...activeErrors]);
    const timer = setTimeout(remove, timeout);
  };

  return (
    <article>
      <div className="editor-control">
        <ErrorList errors={errorEntries} />
        <EditorPopups
          share={{
            active: share,
            content: editorContext.model.getValue(),
            onClose: () => setShare(false)
          }}
          debug={debug}
        />
        <Editor
          model={editorContext.model}
          monaco={editorContext.monaco}
          onCreate={(instance) => {
            setEditorContext({
              ...editorContext,
              instance
            });
          }}
        />
        <div className="editor-side-panel">
          <div>
            <div className="editor-actions">
              <Transpile
                model={editorContext.model}
                onShare={() => setShare(true)}
                showError={showError}
              />
              {editorContext.instance ? (
                <Execute
                  instance={editorContext.instance}
                  model={editorContext.model}
                  showError={showError}
                  setDebug={setDebug}
                />
              ) : null}
              <div className="editor-help">
                <label>Try this:</label>
                <code>
                  <span className="identifier">get_shell</span>(
                  <span className="string">"root"</span>,{' '}
                  <span className="string">"test"</span>){' '}
                  <span className="comment">
                    //to receive root shell on your local pc
                  </span>
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
