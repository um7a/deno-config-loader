// Builtin modules

// Third party modules
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

// Local modules

export type ConfigValueType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

export type ConfigValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

export interface ArgumentKeys {
  short?: string;
  long?: string;
}

export interface ConfigFileProvider {
  argKeys?: ArgumentKeys;
  envKey?: string;
  defaultValue?: string;
  generator?: ConfigFileGenerator;
}

export interface ConfigFileGenerator {
  argKeys: ArgumentKeys;
}

export interface HelpHandler {
  argKeys: ArgumentKeys;
}

export interface ConfigValueRule {
  key: string;
  argKeys?: ArgumentKeys;
  configKey?: string;
  envKey?: string;
  valueType?: ConfigValueType;
  defaultValue?: unknown;
  description?: string;
  required?: boolean;
  validator?: (value: unknown) => unknown;
}

export type ConfigOptionRule = ConfigValueRule;

export type ConfigOperandRule = Omit<ConfigValueRule, "argKeys">;

export interface CommandRule {
  command: string;
  aliases?: readonly string[];
  description?: string;
  options?: readonly ConfigOptionRule[];
  operands?: readonly ConfigOperandRule[];
}

export interface ConfigRule {
  global: {
    configFileProvider?: ConfigFileProvider;
    helpHandler?: HelpHandler;
    options?: readonly ConfigOptionRule[];
    operands?: readonly ConfigOperandRule[];
    commands?: readonly CommandRule[];
  };
}

export interface ConfigLoaderOptions {
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

const defaultHelpArgumentKeys: ArgumentKeys = {
  short: "h",
  long: "help",
};

interface ActiveRule {
  rule: ConfigValueRule;
  configKey?: string;
  argumentValue: unknown;
}

interface ArgumentDefinition {
  keys: ArgumentKeys;
  consumesFollowingValue: boolean;
  consumesOptionalBooleanValue: boolean;
}

interface CommandMatch {
  command: CommandRule;
  position: number;
}

interface ParsedArguments {
  nonOptionArguments: string[];
  commandMatch?: CommandMatch;
  argumentError?: Error;
}

export class ConfigLoader {
  // Private fields
  private readonly configRule: ConfigRule;
  private readonly args: readonly string[];
  private readonly env: Readonly<Record<string, string>>;
  private readonly parsedArguments: ParsedArguments;
  private readonly values: Map<string, unknown>;
  private loaded: boolean;

  // Public fields

  // Private methods
  private findCommand(
    nonOptionArguments: readonly string[],
  ): CommandMatch | undefined {
    const commands = this.configRule.global.commands ?? [];
    for (
      let position = 0;
      position < nonOptionArguments.length;
      position += 1
    ) {
      const argument = nonOptionArguments[position];
      const command = commands.find((candidate) => {
        const names = [candidate.command, ...(candidate.aliases ?? [])];
        return names.includes(argument);
      });
      if (command !== undefined) {
        return { command, position };
      }
    }
    return undefined;
  }

  private getActiveRules(
    nonOptionArguments: readonly string[],
    commandMatch?: CommandMatch,
  ): ActiveRule[] {
    const globalOptions = this.configRule.global.options ?? [];
    const globalRules = globalOptions.map((rule) => ({
      rule,
      configKey: rule.configKey,
      argumentValue: rule.valueType === "array"
        ? this.findArrayArgumentValue(rule.argKeys)
        : this.findArgumentValue(
          rule.argKeys,
          rule.valueType !== "boolean",
          rule.valueType === "boolean",
        ),
    }));
    const globalOperandValues = commandMatch === undefined
      ? nonOptionArguments
      : nonOptionArguments.slice(0, commandMatch.position);
    const globalOperands = (this.configRule.global.operands ?? []).map(
      (rule, index) => ({
        rule,
        configKey: rule.configKey,
        argumentValue: globalOperandValues[index],
      }),
    );
    if (commandMatch === undefined) {
      return [...globalRules, ...globalOperands];
    }

    const command = commandMatch.command;
    const commandOptions = command.options ?? [];
    const commandOperands = command.operands ?? [];
    const optionRules = commandOptions.map((rule) => ({
      rule,
      configKey: rule.configKey,
      argumentValue: rule.valueType === "array"
        ? this.findArrayArgumentValue(rule.argKeys)
        : this.findArgumentValue(
          rule.argKeys,
          rule.valueType !== "boolean",
          rule.valueType === "boolean",
        ),
    }));
    const commandOperandValues = nonOptionArguments.slice(
      commandMatch.position + 1,
    );
    const operandRules = commandOperands.map((rule, index) => ({
      rule,
      configKey: rule.configKey,
      argumentValue: commandOperandValues[index],
    }));
    return [...globalRules, ...globalOperands, ...optionRules, ...operandRules];
  }

  private getConfigGenerationRules(
    nonOptionArguments: readonly string[],
    commandMatch?: CommandMatch,
  ): ActiveRule[] {
    const activeRules = this.getActiveRules(
      nonOptionArguments,
      commandMatch,
    );
    const globalRuleCount = (this.configRule.global.options?.length ?? 0) +
      (this.configRule.global.operands?.length ?? 0);
    const globalRules = activeRules.slice(0, globalRuleCount);
    const activeCommandRules = activeRules.slice(globalRuleCount);
    const commandRules = (this.configRule.global.commands ?? []).flatMap(
      (command) => {
        if (command === commandMatch?.command) {
          return activeCommandRules;
        }
        return [...(command.options ?? []), ...(command.operands ?? [])].map(
          (rule) => ({
            rule,
            configKey: rule.configKey,
            argumentValue: undefined,
          }),
        );
      },
    );
    return [...globalRules, ...commandRules];
  }

  private getArgumentDefinitions(): ArgumentDefinition[] {
    const definitions: ArgumentDefinition[] = [];
    const provider = this.configRule.global.configFileProvider;
    const providerKeys = provider?.argKeys;
    if (providerKeys !== undefined) {
      definitions.push({
        keys: providerKeys,
        consumesFollowingValue: true,
        consumesOptionalBooleanValue: false,
      });
    }
    const generatorKeys = provider?.generator?.argKeys;
    if (generatorKeys !== undefined) {
      definitions.push({
        keys: generatorKeys,
        consumesFollowingValue: false,
        consumesOptionalBooleanValue: false,
      });
    }

    definitions.push({
      keys: this.getHelpArgumentKeys(),
      consumesFollowingValue: false,
      consumesOptionalBooleanValue: false,
    });

    const globalOptions = this.configRule.global.options ?? [];
    const commandOptions = (this.configRule.global.commands ?? []).flatMap(
      (command) => command.options ?? [],
    );
    for (const rule of [...globalOptions, ...commandOptions]) {
      if (rule.argKeys !== undefined) {
        definitions.push({
          keys: rule.argKeys,
          consumesFollowingValue: rule.valueType !== "boolean",
          consumesOptionalBooleanValue: rule.valueType === "boolean",
        });
      }
    }
    return definitions;
  }

  private getHelpArgumentKeys(): ArgumentKeys {
    return this.configRule.global.helpHandler?.argKeys ??
      defaultHelpArgumentKeys;
  }

  private hasEnvironmentRules(): boolean {
    const global = this.configRule.global;
    const valueRules = [
      ...(global.options ?? []),
      ...(global.operands ?? []),
      ...(global.commands ?? []).flatMap((command) => [
        ...(command.options ?? []),
        ...(command.operands ?? []),
      ]),
    ];
    return global.configFileProvider?.envKey !== undefined ||
      valueRules.some((rule) => rule.envKey !== undefined);
  }

  private parseArguments(): ParsedArguments {
    const definitions = this.getArgumentDefinitions();
    const nonOptionArguments: string[] = [];
    for (let index = 0; index < this.args.length; index += 1) {
      const argument = this.args[index];

      // Equals-sign assignment is supported only for long options.
      // Short options take their value as the following argument.
      const assignedOption = definitions.find(({ keys }) =>
        keys.long !== undefined &&
        argument.startsWith(`--${keys.long}=`)
      );
      if (assignedOption !== undefined) {
        if (argument === `--${assignedOption.keys.long}=`) {
          return {
            nonOptionArguments,
            argumentError: new Error(
              `Missing value for argument: --${assignedOption.keys.long}`,
            ),
          };
        }
        continue;
      }

      const option = definitions.find(({ keys }) =>
        (keys.long !== undefined && argument === `--${keys.long}`) ||
        (keys.short !== undefined && argument === `-${keys.short}`)
      );
      if (option !== undefined) {
        const next = this.args[index + 1];
        if (option.consumesFollowingValue) {
          if (next === undefined || next.startsWith("-")) {
            return {
              nonOptionArguments,
              argumentError: new Error(
                `Missing value for argument: ${argument}`,
              ),
            };
          } else {
            index += 1;
          }
        } else if (
          option.consumesOptionalBooleanValue &&
          this.isBooleanLiteral(next)
        ) {
          index += 1;
        }
        continue;
      }

      if (argument.startsWith("-")) {
        return {
          nonOptionArguments,
          argumentError: new Error(`Unknown argument: ${argument}`),
        };
      }

      nonOptionArguments.push(argument);
    }
    return {
      nonOptionArguments,
      commandMatch: this.findCommand(nonOptionArguments),
    };
  }

  private validateArguments(parsedArguments: ParsedArguments): void {
    if (parsedArguments.argumentError !== undefined) {
      throw parsedArguments.argumentError;
    }

    const { nonOptionArguments, commandMatch } = parsedArguments;
    const globalOperandCount = this.configRule.global.operands?.length ?? 0;
    if (commandMatch !== undefined) {
      if (commandMatch.position > globalOperandCount) {
        throw new Error(
          `Unexpected operand: ${nonOptionArguments[globalOperandCount]}`,
        );
      }

      const commandOperandCount = commandMatch.command.operands?.length ?? 0;
      const firstUnexpectedPosition = commandMatch.position + 1 +
        commandOperandCount;
      if (nonOptionArguments.length > firstUnexpectedPosition) {
        throw new Error(
          `Unexpected operand: ${nonOptionArguments[firstUnexpectedPosition]}`,
        );
      }
      return;
    }

    if (nonOptionArguments.length <= globalOperandCount) {
      return;
    }

    const unexpected = nonOptionArguments[globalOperandCount];
    if ((this.configRule.global.commands?.length ?? 0) > 0) {
      throw new Error(`Unknown command: ${unexpected}`);
    }
    throw new Error(`Unexpected operand: ${unexpected}`);
  }

  private formatArgumentKeys(
    keys: ArgumentKeys,
    consumesFollowingValue: boolean,
  ): string {
    const labels = [
      keys.short === undefined ? undefined : `-${keys.short}`,
      keys.long === undefined ? undefined : `--${keys.long}`,
    ].filter((label): label is string => label !== undefined);
    const suffix = consumesFollowingValue ? " <value>" : "";
    return `${labels.join(", ")}${suffix}`;
  }

  private formatHelpValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }

  private formatHelpDescription(
    description: string | undefined,
    defaultValue: unknown,
  ): string | undefined {
    if (defaultValue === undefined) {
      return description;
    }

    const detailText = `(Default: ${this.formatHelpValue(defaultValue)})`;
    return description === undefined || description === ""
      ? detailText
      : `${description} ${detailText}`;
  }

  private appendHelpSection(
    lines: string[],
    title: string,
    entries: readonly (readonly [string, string?])[],
  ): void {
    if (entries.length === 0) {
      return;
    }

    const labelWidth = Math.max(...entries.map(([label]) => label.length));
    lines.push("", `${title}:`);
    for (const [label, description] of entries) {
      const suffix = description === undefined
        ? ""
        : `${" ".repeat(labelWidth - label.length + 2)}${description}`;
      lines.push(`  ${label}${suffix}`);
    }
  }

  private findArgumentValue(
    keys?: ArgumentKeys,
    consumesFollowingValue = true,
    consumesOptionalBooleanValue = false,
  ): unknown {
    return this.findArgumentValues(
      keys,
      consumesFollowingValue,
      consumesOptionalBooleanValue,
    )[0];
  }

  private findArgumentValues(
    keys?: ArgumentKeys,
    consumesFollowingValue = true,
    consumesOptionalBooleanValue = false,
  ): unknown[] {
    if (keys === undefined) {
      return [];
    }

    const values: unknown[] = [];
    for (let index = 0; index < this.args.length; index += 1) {
      const argument = this.args[index];
      if (keys.long !== undefined && argument.startsWith(`--${keys.long}=`)) {
        values.push(argument.slice(keys.long.length + 3));
        continue;
      }
      if (
        (keys.long !== undefined && argument === `--${keys.long}`) ||
        (keys.short !== undefined && argument === `-${keys.short}`)
      ) {
        const next = this.args[index + 1];
        const consumesBooleanValue = consumesOptionalBooleanValue &&
          this.isBooleanLiteral(next);
        values.push(
          (!consumesFollowingValue && !consumesBooleanValue) ||
            next === undefined || next.startsWith("-")
            ? true
            : next,
        );
      }
    }
    return values;
  }

  private isBooleanLiteral(value: string | undefined): boolean {
    return value !== undefined &&
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(
        value.toLowerCase(),
      );
  }

  private findArrayArgumentValue(keys?: ArgumentKeys): unknown {
    const values = this.findArgumentValues(keys);
    if (values.length === 0) {
      return undefined;
    }
    return values.flatMap(
      (value) => this.convertValue(value, "array") as unknown[],
    );
  }

  private async readConfigFile(): Promise<unknown> {
    const provider = this.configRule.global.configFileProvider;
    if (provider === undefined) {
      return {};
    }

    const argumentValue = this.findArgumentValue(provider.argKeys);
    const environmentValue = provider.envKey === undefined
      ? undefined
      : this.env[provider.envKey];
    const filePath = argumentValue ?? environmentValue ?? provider.defaultValue;
    if (filePath === undefined) {
      return {};
    }
    if (typeof filePath !== "string") {
      throw new TypeError("The configuration file path must be a string");
    }

    const yaml = await Deno.readTextFile(filePath);
    const parsed = parseYaml(yaml);
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("The YAML configuration root must be an object");
    }
    return parsed;
  }

  private getNestedValue(source: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, segment) => {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, source);
  }

  private setNestedValue(
    target: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const segments = path.split(".");
    let current = target;
    for (const segment of segments.slice(0, -1)) {
      const existing = current[segment];
      if (existing === undefined) {
        const nested: Record<string, unknown> = {};
        current[segment] = nested;
        current = nested;
        continue;
      }
      if (
        existing === null || typeof existing !== "object" ||
        Array.isArray(existing)
      ) {
        throw new Error(`Conflicting configuration key: ${path}`);
      }
      current = existing as Record<string, unknown>;
    }
    current[segments.at(-1) as string] = value;
  }

  private getGeneratedDescriptionMarkerPrefix(
    activeRules: readonly ActiveRule[],
  ): string {
    let prefix = "__CONFIG_LOADER_DESCRIPTION_";
    while (
      activeRules.some((activeRule) =>
        activeRule.configKey?.split(".").some((segment) =>
          segment.startsWith(prefix)
        ) ?? false
      )
    ) {
      prefix = `_${prefix}`;
    }
    return prefix;
  }

  private replaceGeneratedDescriptionMarkers(
    yaml: string,
    markerPrefix: string,
    descriptions: readonly string[],
  ): string {
    const markerPattern = new RegExp(
      `^(\\s*)${markerPrefix}(\\d+)__: null$`,
    );
    return yaml.split("\n").flatMap((line) => {
      const match = markerPattern.exec(line);
      if (match === null) {
        return line;
      }

      const description = descriptions[Number(match[2])];
      if (description === undefined) {
        return line;
      }
      const indentation = match[1];
      return description.split(/\r\n|\n|\r/).map((descriptionLine) =>
        descriptionLine === ""
          ? `${indentation}#`
          : `${indentation}# ${descriptionLine}`
      );
    }).join("\n");
  }

  private convertValue(value: unknown, type?: ConfigValueType): unknown {
    if (value === undefined || type === undefined) {
      return value;
    }

    switch (type) {
      case "string":
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
        break;
      case "number": {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "") {
          const numberValue = Number(value);
          if (Number.isFinite(numberValue)) return numberValue;
        }
        break;
      }
      case "boolean":
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          const normalized = value.toLowerCase();
          if (["true", "1", "yes", "on"].includes(normalized)) return true;
          if (["false", "0", "no", "off"].includes(normalized)) return false;
        }
        break;
      case "array": {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          return value.split(",").map((item) => item.trim());
        }
        break;
      }
      case "object": {
        if (
          value !== null && typeof value === "object" && !Array.isArray(value)
        ) {
          return value;
        }
        const parsed = this.parseStructuredValue(value);
        if (
          parsed !== null && typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          return parsed;
        }
        break;
      }
    }
    throw new TypeError(`Cannot convert value to ${type}: ${String(value)}`);
  }

  private parseStructuredValue(value: unknown): unknown {
    if (typeof value !== "string") {
      return undefined;
    }
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private resolveValue(
    rule: ConfigValueRule,
    configValue: unknown,
    argumentValue: unknown,
  ): unknown {
    const environmentValue = rule.envKey === undefined
      ? undefined
      : this.env[rule.envKey];
    const sourceValue = argumentValue ?? environmentValue ?? configValue ??
      rule.defaultValue;
    if (sourceValue === undefined) {
      if (rule.required === true) {
        throw new Error(`Missing required configuration value: ${rule.key}`);
      }
      return undefined;
    }

    const converted = this.convertValue(sourceValue, rule.valueType);
    return rule.validator === undefined ? converted : rule.validator(converted);
  }

  private resolveGeneratedValue(
    rule: ConfigValueRule,
    argumentValue: unknown,
  ): unknown {
    const environmentValue = rule.envKey === undefined
      ? undefined
      : this.env[rule.envKey];
    const sourceValue = argumentValue ?? environmentValue ?? rule.defaultValue;
    if (sourceValue === undefined) {
      return undefined;
    }

    const converted = this.convertValue(sourceValue, rule.valueType);
    return rule.validator === undefined ? converted : rule.validator(converted);
  }

  private getValue(key: string): unknown {
    if (!this.loaded) {
      throw new Error(
        "ConfigLoader.load() must be called before reading values",
      );
    }
    if (!this.values.has(key)) {
      throw new Error(`Configuration value not found: ${key}`);
    }
    return this.values.get(key);
  }

  // Public methods
  public constructor(
    configRule: ConfigRule,
    options: ConfigLoaderOptions = {},
  ) {
    this.configRule = configRule;
    this.args = options.args ?? Deno.args;
    this.env = options.env ??
      (this.hasEnvironmentRules() ? Deno.env.toObject() : {});
    this.parsedArguments = this.parseArguments();
    this.values = new Map();
    this.loaded = false;
  }

  public async load(): Promise<void> {
    const parsedArguments = this.parsedArguments;
    this.validateArguments(parsedArguments);
    const { nonOptionArguments, commandMatch: command } = parsedArguments;
    const activeRules = this.getActiveRules(nonOptionArguments, command);
    const fileConfig = await this.readConfigFile();

    this.values.clear();
    for (const activeRule of activeRules) {
      const configValue = activeRule.configKey === undefined
        ? undefined
        : this.getNestedValue(fileConfig, activeRule.configKey);
      const value = this.resolveValue(
        activeRule.rule,
        configValue,
        activeRule.argumentValue,
      );
      if (value !== undefined) {
        this.values.set(activeRule.rule.key, value);
      }
    }
    this.loaded = true;
  }

  public getCommand(): string | undefined {
    return this.parsedArguments.commandMatch?.command.command;
  }

  public isHelp(): boolean {
    return this.findArgumentValue(this.getHelpArgumentKeys(), false) === true;
  }

  public isGenerateConfig(): boolean {
    const keys = this.configRule.global.configFileProvider?.generator?.argKeys;
    return keys !== undefined &&
      this.findArgumentValue(keys, false) === true;
  }

  public genConfig(): string {
    const generator = this.configRule.global.configFileProvider?.generator;
    if (generator === undefined) {
      throw new Error("Configuration file generation is not configured");
    }
    const parsedArguments = this.parsedArguments;
    this.validateArguments(parsedArguments);
    const { nonOptionArguments, commandMatch: command } = parsedArguments;
    const activeRules = this.getConfigGenerationRules(
      nonOptionArguments,
      command,
    );
    const generatedConfig: Record<string, unknown> = {};
    const markerPrefix = this.getGeneratedDescriptionMarkerPrefix(activeRules);
    const descriptions: string[] = [];
    for (const activeRule of activeRules) {
      if (activeRule.configKey === undefined) {
        continue;
      }
      const value = this.resolveGeneratedValue(
        activeRule.rule,
        activeRule.argumentValue,
      );
      if (value !== undefined) {
        const description = activeRule.rule.description;
        if (description !== undefined && description !== "") {
          const segments = activeRule.configKey.split(".");
          const marker = `${markerPrefix}${descriptions.length}__`;
          this.setNestedValue(
            generatedConfig,
            [...segments.slice(0, -1), marker].join("."),
            null,
          );
          descriptions.push(description);
        }
        this.setNestedValue(generatedConfig, activeRule.configKey, value);
      }
    }
    return this.replaceGeneratedDescriptionMarkers(
      stringifyYaml(generatedConfig),
      markerPrefix,
      descriptions,
    );
  }

  public genHelpMessage(commandName: string): string {
    const global = this.configRule.global;
    const command = this.parsedArguments.commandMatch?.command;
    const globalOperands = global.operands ?? [];
    const usageParts = (command === undefined
      ? [
        "[options]",
        ...globalOperands.map((operand) =>
          operand.required === true ? `<${operand.key}>` : `[${operand.key}]`
        ),
        (global.commands?.length ?? 0) > 0 ? "<command>" : undefined,
      ]
      : [
        command.command,
        (command.options?.length ?? 0) > 0 ? "[options]" : undefined,
        ...(command.operands ?? []).map((operand) =>
          operand.required === true ? `<${operand.key}>` : `[${operand.key}]`
        ),
      ]).filter((part): part is string => part !== undefined);
    const lines = ["Usage:", `  ${[commandName, ...usageParts].join(" ")}`];

    const globalOptionEntries: [string, string?][] = [];
    const configFileKeys = global.configFileProvider?.argKeys;
    if (configFileKeys !== undefined) {
      globalOptionEntries.push([
        this.formatArgumentKeys(configFileKeys, true),
        this.formatHelpDescription(
          "Path to the configuration file",
          global.configFileProvider?.defaultValue,
        ),
      ]);
    }
    const generatorKeys = global.configFileProvider?.generator?.argKeys;
    if (generatorKeys !== undefined) {
      globalOptionEntries.push([
        this.formatArgumentKeys(generatorKeys, false),
        "Generate configuration YAML",
      ]);
    }
    const helpKeys = this.getHelpArgumentKeys();
    globalOptionEntries.push([
      this.formatArgumentKeys(helpKeys, false),
      "Show this help message",
    ]);
    for (const option of global.options ?? []) {
      if (option.argKeys !== undefined) {
        globalOptionEntries.push([
          this.formatArgumentKeys(
            option.argKeys,
            option.valueType !== "boolean",
          ),
          this.formatHelpDescription(
            option.description,
            option.defaultValue,
          ),
        ]);
      }
    }
    const helpArgument = helpKeys?.short !== undefined
      ? `-${helpKeys.short}`
      : helpKeys?.long !== undefined
      ? `--${helpKeys.long}`
      : undefined;
    if (command === undefined) {
      this.appendHelpSection(lines, "Global options", globalOptionEntries);
      this.appendHelpSection(
        lines,
        "Global operands",
        globalOperands.map((operand) => [
          operand.key,
          this.formatHelpDescription(
            operand.description,
            operand.defaultValue,
          ),
        ]),
      );
      this.appendHelpSection(
        lines,
        "Commands",
        (global.commands ?? []).map((item) => [
          [item.command, ...(item.aliases ?? [])].join(", "),
          item.description,
        ]),
      );
      if ((global.commands?.length ?? 0) > 0 && helpArgument !== undefined) {
        lines.push(
          "",
          `Use '${commandName} <command> ${helpArgument}' to show command-specific help.`,
        );
      }
    } else {
      this.appendHelpSection(lines, "Command", [[
        [command.command, ...(command.aliases ?? [])].join(", "),
        command.description,
      ]]);
      this.appendHelpSection(
        lines,
        "Options",
        (command.options ?? [])
          .filter((option) => option.argKeys !== undefined)
          .map((option) => [
            this.formatArgumentKeys(
              option.argKeys as ArgumentKeys,
              option.valueType !== "boolean",
            ),
            this.formatHelpDescription(
              option.description,
              option.defaultValue,
            ),
          ]),
      );
      this.appendHelpSection(
        lines,
        "Operands",
        (command.operands ?? []).map((operand) => [
          operand.key,
          this.formatHelpDescription(
            operand.description,
            operand.defaultValue,
          ),
        ]),
      );
      if (helpArgument !== undefined) {
        lines.push(
          "",
          `Use '${commandName} ${helpArgument}' without a command to show global options and operands.`,
        );
      }
    }

    return lines.join("\n");
  }

  public getString(key: string): string {
    const value = this.getValue(key);
    if (typeof value !== "string") {
      throw new TypeError(`Configuration value is not a string: ${key}`);
    }
    return value;
  }

  public getNumber(key: string): number {
    const value = this.getValue(key);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`Configuration value is not a number: ${key}`);
    }
    return value;
  }

  public getBoolean(key: string): boolean {
    const value = this.getValue(key);
    if (typeof value !== "boolean") {
      throw new TypeError(`Configuration value is not a boolean: ${key}`);
    }
    return value;
  }

  public getArray<T = unknown>(key: string): T[] {
    const value = this.getValue(key);
    if (!Array.isArray(value)) {
      throw new TypeError(`Configuration value is not an array: ${key}`);
    }
    return value as T[];
  }

  public getObject<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
  ): T {
    const value = this.getValue(key);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`Configuration value is not an object: ${key}`);
    }
    return value as T;
  }
}
