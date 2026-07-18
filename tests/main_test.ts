// Builtin modules

// Third party modules
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";

// Local modules
import { ConfigLoader, type ConfigRule } from "../src/config_loader.ts";

const rule: ConfigRule = {
  global: {
    configFileProvider: {
      argKeys: { short: "c", long: "config" },
      envKey: "APP_CONFIG_FILE",
      generator: {
        argKeys: { long: "generate-config" },
      },
    },
    options: [
      {
        key: "port",
        argKeys: { short: "p", long: "port" },
        configKey: "server.port",
        envKey: "APP_PORT",
        valueType: "number",
        defaultValue: 3000,
      },
      {
        key: "debug",
        argKeys: { long: "debug" },
        configKey: "server.debug",
        envKey: "APP_DEBUG",
        valueType: "boolean",
      },
      {
        key: "names",
        argKeys: { long: "names" },
        configKey: "names",
        envKey: "APP_NAMES",
        valueType: "array",
      },
      {
        key: "metadata",
        configKey: "metadata",
        envKey: "APP_METADATA",
        valueType: "object",
      },
    ],
    commands: [
      {
        command: "run",
        aliases: ["r"],
        options: [
          {
            key: "target",
            argKeys: { short: "t", long: "target" },
            configKey: "run.target",
            envKey: "APP_TARGET",
            valueType: "string",
          },
        ],
      },
    ],
  },
};

Deno.test("does not read environment variables without environment rules", async () => {
  const originalToObject = Deno.env.toObject;
  let environmentRead = false;
  Object.defineProperty(Deno.env, "toObject", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: () => {
      environmentRead = true;
      return {};
    },
  });

  try {
    const loader = new ConfigLoader({
      global: {
        options: [
          {
            key: "port",
            argKeys: { long: "port" },
            valueType: "number",
          },
        ],
      },
    }, {
      args: ["--port", "8080"],
    });

    await loader.load();

    assertEquals(loader.getNumber("port"), 8080);
    assertEquals(environmentRead, false);
  } finally {
    Object.defineProperty(Deno.env, "toObject", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: originalToObject,
    });
  }
});

Deno.test("loads typed values from YAML", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(
      path,
      "server:\n  port: 4000\n  debug: true\nnames: [alice, bob]\nmetadata:\n  region: us\nrun:\n  target: app.ts\n",
    );
    const loader = new ConfigLoader(rule, {
      args: ["run", "-c", path],
      env: {},
    });

    await loader.load();

    assertEquals(loader.getNumber("port"), 4000);
    assertEquals(loader.getBoolean("debug"), true);
    assertEquals(loader.getArray("names"), ["alice", "bob"]);
    assertEquals(loader.getObject("metadata"), { region: "us" });
    assertEquals(loader.getString("target"), "app.ts");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("uses arguments before environment and YAML", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(path, "server:\n  port: 4000\n");
    const loader = new ConfigLoader(rule, {
      args: ["--config", path, "--port=6000"],
      env: { APP_PORT: "5000" },
    });

    await loader.load();

    assertEquals(loader.getNumber("port"), 6000);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("uses environment before YAML and parses structured values", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(path, "server:\n  port: 4000\nmetadata: {}\n");
    const loader = new ConfigLoader(rule, {
      args: ["-c", path],
      env: {
        APP_PORT: "5000",
        APP_NAMES: "red, green",
        APP_METADATA: '{"region":"eu"}',
      },
    });

    await loader.load();

    assertEquals(loader.getNumber("port"), 5000);
    assertEquals(loader.getArray("names"), ["red", "green"]);
    assertEquals(loader.getObject("metadata"), { region: "eu" });
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("ignores YAML values when configKey is not configured", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(path, "port: 4000\n");
    const loader = new ConfigLoader({
      global: {
        configFileProvider: {
          argKeys: { long: "config" },
        },
        options: [
          {
            key: "port",
            defaultValue: 3000,
            valueType: "number",
          },
        ],
      },
    }, {
      args: ["--config", path],
      env: {},
    });

    await loader.load();

    assertEquals(loader.getNumber("port"), 3000);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("generates YAML from arguments, environment, and defaults", () => {
  const loader = new ConfigLoader(rule, {
    args: ["--generate-config", "run", "--port", "6000"],
    env: {
      APP_DEBUG: "true",
      APP_TARGET: "app.ts",
    },
  });

  assertEquals(loader.isGenerateConfig(), true);
  assertEquals(
    loader.genConfig(),
    "server:\n  port: 6000\n  debug: true\nrun:\n  target: app.ts\n",
  );
});

Deno.test("adds descriptions as comments to generated YAML", () => {
  const describedRule: ConfigRule = {
    global: {
      configFileProvider: {
        generator: {
          argKeys: { long: "generate-config" },
        },
      },
      options: [
        {
          key: "port",
          configKey: "server.port",
          defaultValue: 3000,
          description: "Server port\nUsed by the HTTP server",
        },
        {
          key: "debug",
          configKey: "server.debug",
          defaultValue: true,
          description: "",
        },
      ],
    },
  };
  const loader = new ConfigLoader(describedRule, {
    args: ["--generate-config"],
    env: {},
  });

  assertEquals(
    loader.genConfig(),
    "server:\n  # Server port\n  # Used by the HTTP server\n  port: 3000\n  debug: true\n",
  );
});

Deno.test("omits generated values when configKey is not configured", () => {
  const loader = new ConfigLoader({
    global: {
      configFileProvider: {
        generator: {
          argKeys: { long: "generate-config" },
        },
      },
      options: [
        {
          key: "port",
          defaultValue: 3000,
        },
      ],
    },
  }, {
    args: ["--generate-config"],
    env: {},
  });

  assertEquals(loader.genConfig(), "{}\n");
});

Deno.test("omits generated values without arguments, environment, or defaults", () => {
  const requiredRule: ConfigRule = {
    global: {
      ...rule.global,
      options: [
        ...rule.global.options ?? [],
        {
          key: "requiredValue",
          configKey: "requiredValue",
          required: true,
        },
      ],
    },
  };
  const loader = new ConfigLoader(requiredRule, {
    args: ["--generate-config"],
    env: {},
  });

  assertEquals(loader.genConfig(), "server:\n  port: 3000\n");
});

Deno.test("disables configuration generation when it is not configured", () => {
  const loader = new ConfigLoader({ global: {} }, {
    args: ["--generate-config"],
    env: {},
  });

  assertEquals(loader.isGenerateConfig(), false);
  assertThrows(
    () => loader.genConfig(),
    Error,
    "Configuration file generation is not configured",
  );
});

Deno.test("appends repeated array arguments while preserving comma-separated values", async () => {
  const loader = new ConfigLoader(rule, {
    args: [
      "--names",
      "alice,bob",
      "--names=carol",
      "--names",
      "dave,eve",
    ],
    env: {},
  });

  await loader.load();

  assertEquals(
    loader.getArray("names"),
    ["alice", "bob", "carol", "dave", "eve"],
  );
});

Deno.test("accepts boolean option values separated by spaces", async () => {
  const trueLoader = new ConfigLoader(rule, {
    args: ["--debug", "true", "run"],
    env: {},
  });
  const falseLoader = new ConfigLoader(rule, {
    args: ["--debug", "false", "run"],
    env: {},
  });
  const flagLoader = new ConfigLoader(rule, {
    args: ["--debug", "run"],
    env: {},
  });

  await trueLoader.load();
  await falseLoader.load();
  await flagLoader.load();

  assertEquals(trueLoader.getBoolean("debug"), true);
  assertEquals(trueLoader.getCommand(), "run");
  assertEquals(falseLoader.getBoolean("debug"), false);
  assertEquals(falseLoader.getCommand(), "run");
  assertEquals(flagLoader.getBoolean("debug"), true);
  assertEquals(flagLoader.getCommand(), "run");
});

Deno.test("requires load and reports type mismatches", async () => {
  const loader = new ConfigLoader(rule, { args: [], env: {} });
  assertThrows(() => loader.getNumber("port"), Error, "load()");

  await loader.load();

  assertEquals(loader.getNumber("port"), 3000);
  assertThrows(() => loader.getString("port"), TypeError, "not a string");
  assertThrows(() => loader.getBoolean("debug"), Error, "not found");
});

Deno.test("rejects invalid converted values", async () => {
  const loader = new ConfigLoader(rule, {
    args: ["--port", "not-a-number"],
    env: {},
  });
  await assertRejects(() => loader.load(), TypeError, "number");
});

Deno.test("rejects undefined and malformed arguments during load", async () => {
  const unknownArgumentLoader = new ConfigLoader(rule, {
    args: ["--unknown"],
    env: {},
  });
  await assertRejects(
    () => unknownArgumentLoader.load(),
    Error,
    "Unknown argument: --unknown",
  );

  const endOfOptionsLoader = new ConfigLoader(rule, {
    args: ["--"],
    env: {},
  });
  await assertRejects(
    () => endOfOptionsLoader.load(),
    Error,
    "Unknown argument: --",
  );

  const negatedBooleanLoader = new ConfigLoader(rule, {
    args: ["--no-debug"],
    env: {},
  });
  await assertRejects(
    () => negatedBooleanLoader.load(),
    Error,
    "Unknown argument: --no-debug",
  );

  const missingValueLoader = new ConfigLoader(rule, {
    args: ["--port"],
    env: {},
  });
  await assertRejects(
    () => missingValueLoader.load(),
    Error,
    "Missing value for argument: --port",
  );

  const emptyAssignedValueLoader = new ConfigLoader(rule, {
    args: ["--port="],
    env: {},
  });
  await assertRejects(
    () => emptyAssignedValueLoader.load(),
    Error,
    "Missing value for argument: --port",
  );

  const emptyAssignedBooleanLoader = new ConfigLoader(rule, {
    args: ["--debug="],
    env: {},
  });
  await assertRejects(
    () => emptyAssignedBooleanLoader.load(),
    Error,
    "Missing value for argument: --debug",
  );

  const unknownCommandLoader = new ConfigLoader(rule, {
    args: ["build"],
    env: {},
  });
  await assertRejects(
    () => unknownCommandLoader.load(),
    Error,
    "Unknown command: build",
  );

  const unexpectedOperandLoader = new ConfigLoader(rule, {
    args: ["run", "extra"],
    env: {},
  });
  await assertRejects(
    () => unexpectedOperandLoader.load(),
    Error,
    "Unexpected operand: extra",
  );
});

Deno.test("rejects undefined arguments during configuration generation", () => {
  const loader = new ConfigLoader(rule, {
    args: ["--generate-config", "--unknown"],
    env: {},
  });

  assertThrows(
    () => loader.genConfig(),
    Error,
    "Unknown argument: --unknown",
  );
});

Deno.test("detects help arguments and generates global help", () => {
  const shortHelpLoader = new ConfigLoader(rule, { args: ["-h"], env: {} });
  const longHelpLoader = new ConfigLoader(rule, { args: ["--help"], env: {} });
  const regularLoader = new ConfigLoader(rule, { args: [], env: {} });

  assertEquals(shortHelpLoader.isHelp(), true);
  assertEquals(longHelpLoader.isHelp(), true);
  assertEquals(regularLoader.isHelp(), false);

  const message = longHelpLoader.genHelpMessage("test-app");
  assertStringIncludes(
    message,
    "Usage:\n  test-app [options] <command>",
  );
  assertStringIncludes(
    message,
    "-c, --config <value>  Path to the configuration file",
  );
  assertStringIncludes(message, "--generate-config");
  assertStringIncludes(message, "-h, --help");
  assertStringIncludes(
    message,
    "-p, --port <value>    (Default: 3000)",
  );
  assertEquals(message.includes("Env:"), false);
  assertStringIncludes(message, "run, r");
  assertStringIncludes(
    message,
    "Use 'test-app <command> -h' to show command-specific help.",
  );
});

Deno.test("gets the active command using its canonical name", () => {
  const commandLoader = new ConfigLoader(rule, {
    args: ["run"],
    env: {},
  });
  const aliasLoader = new ConfigLoader(rule, {
    args: ["r"],
    env: {},
  });
  const noCommandLoader = new ConfigLoader(rule, {
    args: [],
    env: {},
  });

  assertEquals(commandLoader.getCommand(), "run");
  assertEquals(aliasLoader.getCommand(), "run");
  assertEquals(noCommandLoader.getCommand(), undefined);
});

Deno.test("does not return a command after an argument error", () => {
  const loader = new ConfigLoader(rule, {
    args: ["--unknown", "run"],
    env: {},
  });

  assertEquals(loader.getCommand(), undefined);
});

Deno.test("allows overriding the default help arguments", () => {
  const customRule: ConfigRule = {
    global: {
      helpHandler: {
        argKeys: { short: "?", long: "usage" },
      },
    },
  };
  const customHelpLoader = new ConfigLoader(customRule, {
    args: ["--usage"],
    env: {},
  });
  const defaultHelpLoader = new ConfigLoader(customRule, {
    args: ["--help"],
    env: {},
  });

  assertEquals(customHelpLoader.isHelp(), true);
  assertEquals(defaultHelpLoader.isHelp(), false);
  assertStringIncludes(
    customHelpLoader.genHelpMessage("test-app"),
    "-?, --usage",
  );
});

Deno.test("generates command help for the active command", () => {
  const loader = new ConfigLoader(rule, {
    args: ["run", "--help"],
    env: {},
  });

  const message = loader.genHelpMessage("test-app");
  assertStringIncludes(message, "Usage:\n  test-app run [options]");
  assertStringIncludes(message, "Command:\n  run, r");
  assertStringIncludes(message, "Options:\n  -t, --target <value>");
  assertEquals(message.includes("Env:"), false);
  assertEquals(message.includes("Global options:"), false);
  assertEquals(message.includes("Global operands:"), false);
  assertStringIncludes(
    message,
    "Use 'test-app -h' without a command to show global options and operands.",
  );
});
