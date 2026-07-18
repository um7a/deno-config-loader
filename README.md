# Config Loader

`ConfigLoader` resolves typed application settings from command-line arguments,
environment variables, YAML files, and default values.

Values are resolved in this order:

1. Command-line arguments
2. Environment variables
3. YAML configuration
4. Default values

## Installation

```sh
deno add jsr:@um7a/config-loader
```

## Usage

### Command-line arguments only

The following example reads configuration from command-line arguments only. It
also prints generated help when `--help` is specified or argument validation
fails.

```ts
import { ConfigLoader, type ConfigRule } from "@um7a/config-loader";

const rule: ConfigRule = {
  global: {
    options: [
      {
        key: "port",
        argKeys: { short: "p", long: "port" },
        valueType: "number",
        defaultValue: 3000,
        description: "Port to listen on",
      },
      {
        key: "debug",
        argKeys: { long: "debug" },
        valueType: "boolean",
        defaultValue: false,
        description: "Enable debug output",
      },
    ],
  },
};

const config = new ConfigLoader(rule);

if (config.isHelp()) {
  console.log(config.genHelpMessage("app"));
} else {
  try {
    await config.load();
    console.log(`port: ${config.getNumber("port")}`);
    console.log(`debug: ${config.getBoolean("debug")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error();
    console.error(config.genHelpMessage("app"));
    Deno.exit(1);
  }
}
```

Run it with values, or ask it to display help:

```sh
deno run app.ts --port 8080 --debug
deno run app.ts --help
```

The default help arguments are `-h` and `--help`. Set
`global.helpHandler.argKeys` to use different arguments.

### Adding environment variables

Add `envKey` to any option that should also accept an environment variable:

```ts
{
  key: "port",
  argKeys: { short: "p", long: "port" },
  envKey: "APP_PORT",
  valueType: "number",
  defaultValue: 3000,
  description: "Port to listen on",
}
```

When at least one `envKey` is configured, the loader reads from `Deno.env`.
Rules without any environment keys do not require environment-variable access.

Grant environment-variable access when running the application:

```sh
APP_PORT=8080 deno run --allow-env app.ts
```

An argument still takes precedence when both sources provide a value. For
example, the following resolves `port` to `9000`:

```sh
APP_PORT=8080 deno run --allow-env app.ts --port 9000
```

### Adding a YAML configuration file

Add a `configFileProvider` to `global` to select a YAML file by argument or
environment variable:

```ts
const rule: ConfigRule = {
  global: {
    configFileProvider: {
      argKeys: { short: "c", long: "config" },
      envKey: "APP_CONFIG_FILE",
    },
    options: [
      {
        key: "port",
        argKeys: { short: "p", long: "port" },
        envKey: "APP_PORT",
        configKey: "server.port",
        valueType: "number",
        defaultValue: 3000,
        description: "Port to listen on",
      },
    ],
  },
};
```

`configKey` is a dot-separated path within the YAML document. For example,
`server.port` reads `port` from this `config.yaml`:

```yaml
server:
  port: 8080
```

Grant read access in addition to environment-variable access:

```sh
deno run --allow-env --allow-read app.ts --config config.yaml
```

The configuration file can instead be selected through `APP_CONFIG_FILE`. A
`defaultValue` on `configFileProvider` can provide a default path.

```sh
APP_CONFIG_FILE=config.yaml deno run --allow-env --allow-read app.ts
```

### Adding commands

Add `commands` when the application has command-specific options or operands:

```ts
const rule: ConfigRule = {
  global: {
    commands: [
      {
        command: "run",
        aliases: ["r"],
        description: "Run the application",
        options: [
          {
            key: "target",
            argKeys: { short: "t", long: "target" },
            valueType: "string",
            required: true,
            description: "Target file",
          },
        ],
      },
    ],
  },
};

const config = new ConfigLoader(rule);

if (config.isHelp()) {
  console.log(config.genHelpMessage("app"));
} else {
  try {
    await config.load();

    switch (config.getCommand()) {
      case "run":
        console.log(`Running ${config.getString("target")}`);
        break;
      case undefined:
        throw new Error("Command is required");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error();
    console.error(config.genHelpMessage("app"));
    Deno.exit(1);
  }
}
```

`getCommand()` returns the canonical command name, including when an alias was
used. Placing the command before `--help` generates command-specific help.

```sh
deno run app.ts run --target main.ts
deno run app.ts r --target main.ts
deno run app.ts run --help
```

Global `options` and `operands` can be used together with command-specific ones.

### Generating a configuration file

To enable YAML generation, add `generator` to the configuration file provider:

```ts
configFileProvider: {
  argKeys: { short: "c", long: "config" },
  envKey: "APP_CONFIG_FILE",
  generator: {
    argKeys: { long: "generate-config" },
  },
},
```

Handle the generation argument before calling `load()`:

```ts
if (config.isHelp()) {
  console.log(config.genHelpMessage("app"));
} else if (config.isGenerateConfig()) {
  try {
    console.log(config.genConfig().trimEnd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
} else {
  await config.load();
  // Run the application.
}
```

`genConfig()` builds YAML from command-line arguments, environment variables,
and default values; it does not copy values from an existing configuration file.
Only rules with `configKey` are included. Rule descriptions are emitted as YAML
comments, and selecting a command includes that command's active rules.

```sh
deno run --allow-env app.ts --generate-config --port 8080 > config.yaml
deno run --allow-env app.ts run --target main.ts --generate-config
```

Besides `string`, `number`, and `boolean`, rules can load `array` and `object`
values. Rules also support operands, validation through `validator`, and
required values through `required`.

## License

See [LICENSE](./LICENSE).
