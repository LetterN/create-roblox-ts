import { exec, ExecException } from "child_process";
import fs from "fs-extra";
import kleur from "kleur";
import { lookpath } from "lookpath";
import path from "path";
import prompts from "prompts";
import YAML from "yaml";
import yargs from "yargs";

import { benchmark } from "./util/benchmark";

interface InitOptions {
	yes?: boolean;
	git?: boolean;
	eslint?: boolean;
	prettier?: boolean;
	vscode?: boolean;
	packageManager?: PackageManager;
}

enum InitMode {
	None = "none",
	Game = "game",
	Place = "place",
	Model = "model",
	Plugin = "plugin",
	Package = "package",
}

enum PackageManager {
	NPM = "npm",
	Yarn = "yarn",
	Yarn3 = "yarn3",
	PNPM = "pnpm",
}

interface PackageManagerCommands {
	init: string;
	devInstall: string;
	build: string;
}

const packageManagerCommands: {
	[K in PackageManager]: PackageManagerCommands;
} = {
	[PackageManager.NPM]: {
		init: "npm init -y",
		devInstall: "npm install --silent -D",
		build: "npm run build",
	},
	[PackageManager.Yarn]: {
		init: "yarn init -y",
		devInstall: "yarn add --silent -D",
		build: "yarn run build",
	},
	[PackageManager.Yarn3]: {
		init: "yarn init -y",
		devInstall: "yarn add --silent -D",
		build: "yarn run build",
	},
	[PackageManager.PNPM]: {
		init: "pnpm init",
		devInstall: "pnpm install --silent -D",
		build: "pnpm run build",
	},
};

function cmd(cmdStr: string) {
	return new Promise<string>((resolve, reject) => {
		exec(cmdStr, (error, stdout) => {
			if (error) {
				reject(error);
			}
			resolve(stdout);
		});
	}).catch((error: ExecException) => {
		throw new Error(
			`Command "${error.cmd}" exited with code ${error.code}\n\n${error.message}`
		);
	});
}

const COMPILER_VERSION = "2.1.0"; // TODO
const RBXTS_SCOPE = "@rbxts";
const PACKAGE_ROOT = path.join(__dirname, "..");
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates");

async function init(argv: yargs.Arguments<InitOptions>, initMode: InitMode) {
	// Detect if there are any additional package managers
	// We don't need to prompt the user to use additional package managers if none are installed

	// Although npm is installed by default, it can be uninstalled
	// and replaced by another manager, so check for it to make sure
	const [npmAvailable, pnpmAvailable, yarnAvailable, gitAvailable] = (
		await Promise.allSettled(
			["npm", "pnpm", "yarn", "git"].map((v) => lookpath(v))
		)
	).map((v) => (v.status === "fulfilled" ? v.value !== undefined : true));

	const packageManagerExistance: { [K in PackageManager]: boolean } = {
		[PackageManager.NPM]: npmAvailable,
		[PackageManager.PNPM]: pnpmAvailable,
		[PackageManager.Yarn]: yarnAvailable,
		[PackageManager.Yarn3]: yarnAvailable,
	};

	const packageManagerCount = Object.values(packageManagerExistance).filter(
		(exists) => exists
	).length;

	const {
		template = initMode,
		git = argv.git ?? (argv.yes && gitAvailable) ?? false,
		eslint = argv.eslint ?? argv.yes ?? false,
		prettier = argv.prettier ?? argv.yes ?? false,
		vscode = argv.vscode ?? argv.yes ?? false,
		packageManager = argv.packageManager ?? PackageManager.NPM,
	}: {
		template: InitMode;
		git: boolean;
		eslint: boolean;
		prettier: boolean;
		vscode: boolean;
		packageManager: PackageManager;
	} = await prompts(
		[
			{
				type: () => initMode === InitMode.None && "select",
				name: "template",
				message: "Select template",
				choices: [
					InitMode.Game,
					InitMode.Model,
					InitMode.Plugin,
					InitMode.Package,
				].map((value) => ({
					title: value,
					value,
				})),
				initial: 0,
			},
			{
				type: () =>
					argv.git === undefined &&
					argv.yes === undefined &&
					gitAvailable &&
					"confirm",
				name: "git",
				message: "Configure Git",
				initial: true,
			},
			{
				type: () =>
					argv.eslint === undefined &&
					argv.yes === undefined &&
					"confirm",
				name: "eslint",
				message: "Configure ESLint",
				initial: true,
			},
			{
				type: () =>
					argv.prettier === undefined &&
					argv.yes === undefined &&
					"confirm",
				name: "prettier",
				message: "Configure Prettier",
				initial: true,
			},
			{
				type: () =>
					argv.vscode === undefined &&
					argv.yes === undefined &&
					"confirm",
				name: "vscode",
				message: "Configure VSCode Project Settings",
				initial: true,
			},
			{
				type: () =>
					argv.packageManager === undefined &&
					packageManagerCount > 1 &&
					argv.yes === undefined &&
					"select",
				name: "packageManager",
				message:
					"Multiple package managers detected. Select package manager:",
				choices: Object.entries(PackageManager)
					.filter(
						([, packageManager]) =>
							packageManagerExistance[packageManager]
					)
					.map(([managerDisplayName, managerEnum]) => ({
						title: managerDisplayName,
						value: managerEnum,
					})),
			},
		],
		{ onCancel: () => process.exit(1) }
	);

	const cwd = process.cwd();
	const paths = {
		packageJson: path.join(cwd, "package.json"),
		packageLockJson: path.join(cwd, "package-lock.json"),
		yarnncOld: path.join(cwd, ".yarnrc"),
		yarnnc: path.join(cwd, ".yarnrc.yml"),
		tsconfig: path.join(cwd, "tsconfig.json"),
		gitignore: path.join(cwd, ".gitignore"),
		gitattributes: path.join(cwd, ".gitattributes"),
		eslintrc: path.join(cwd, ".eslintrc.yml"),
		eslintrcIgnore: path.join(cwd, ".eslintignore"),
		prettierrc: path.join(cwd, ".prettierrc.yml"),
		prettierIgnore: path.join(cwd, ".prettierignore"),
		settings: path.join(cwd, ".vscode", "settings.json"),
		extensions: path.join(cwd, ".vscode", "extensions.json"),
	};

	const configTemplate = {
		gitignore: path.join(__dirname, "templates/.gitignore"),
		gitattributes: path.join(__dirname, "templates/.gitattributes"),
		eslintrc: path.join(__dirname, "templates/.eslintrc.yml"),
		eslintrcIgnore: path.join(__dirname, "templates/.eslintignore"),
		prettierrc: path.join(__dirname, "templates/.prettierrc.yml"),
		prettierIgnore: path.join(__dirname, "templates/.prettierignore"),
	};

	const templateDir = path.join(TEMPLATES_DIR, template);

	const pathValues = Object.values(paths);
	for (const fileName of await fs.readdir(templateDir)) {
		pathValues.push(fileName);
	}

	const existingPaths = new Array<string>();
	for (const filePath of pathValues) {
		if (filePath && (await fs.pathExists(filePath))) {
			const stat = await fs.stat(filePath);
			if (
				stat.isFile() ||
				stat.isSymbolicLink() ||
				(await fs.readdir(filePath)).length > 0
			) {
				existingPaths.push(path.relative(cwd, filePath));
			}
		}
	}

	if (existingPaths.length > 0) {
		const pathInfo = existingPaths
			.map((v) => `  - ${kleur.yellow(v)}\n`)
			.join("");
		throw new Error(
			`Cannot initialize project, process could overwrite:\n${pathInfo}`
		);
	}

	const selectedPackageManager = packageManagerCommands[packageManager];

	await benchmark("Initializing package.json..", async () => {
		await cmd(selectedPackageManager.init);
		const pkgJson = await fs.readJson(paths.packageJson);
		pkgJson.scripts = {
			build: "rbxtsc",
			watch: "rbxtsc -w",
		};
		if (template === InitMode.Package) {
			pkgJson.name = RBXTS_SCOPE + "/" + pkgJson.name;
			pkgJson.main = "out/init.lua";
			pkgJson.types = "out/index.d.ts";
			pkgJson.files = ["out", "!**/*.tsbuildinfo"];
			pkgJson.publishConfig = { access: "public" };
			pkgJson.scripts.prepublishOnly = selectedPackageManager.build;
		}
		await fs.outputFile(
			paths.packageJson,
			JSON.stringify(pkgJson, null, 2)
		);
	});

	if (git) {
		await benchmark("Initializing Git..", async () => {
			try {
				await cmd("git init");
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				throw new Error(
					`${error.message}\nDo you not have Git installed? Git CLI is required to use Git functionality. If you do not wish to use Git, answer no to "Configure Git".`
				);
			}
			await fs.copy(configTemplate.gitignore, paths.gitignore);
			await fs.copy(configTemplate.gitattributes, paths.gitattributes);
		});
	}

	await benchmark("Installing dependencies..", async () => {
		const devDependencies = [
			"@rbxts/types",
			`@rbxts/compiler-types@compiler-${COMPILER_VERSION}`,
			"typescript",
		];

		if (prettier) {
			devDependencies.push("prettier");
		}

		if (eslint) {
			devDependencies.push(
				"eslint",
				"@typescript-eslint/parser",
				"eslint-plugin-roblox-ts"
			);
			if (prettier) {
				devDependencies.push("eslint-plugin-prettier");
			}
		}

		await cmd(
			`${selectedPackageManager.devInstall} ${devDependencies.join(" ")}`
		);
	});

	// Need this so that yarn adds the node-linker config
	if (packageManager == PackageManager.Yarn3) {
		await benchmark("Setting up yarn v3..", async () => {
			await cmd("yarn set verion latest");
			await fs.remove(paths.yarnncOld);
			// Verify that node-linker exists
			const yamlData = YAML.parse(
				await fs.readFile(paths.yarnnc, { encoding: "utf8" })
			);
			if (
				!("nodeLinker" in yamlData) ||
				yamlData["nodeLinker"] !== "node-modules"
			) {
				yamlData["nodeLinker"] = "node-modules";
				await fs.writeFile(paths.yarnnc, YAML.stringify(yamlData));
			}
		});
	}

	if (eslint) {
		await benchmark("Configuring ESLint..", async () => {
			await fs.copy(configTemplate.eslintrc, paths.eslintrc);
			await fs.copy(configTemplate.eslintrcIgnore, paths.eslintrcIgnore);

			if (prettier) {
				const eslintConfig = YAML.parse(
					await fs.readFile(paths.eslintrc, { encoding: "utf8" })
				);
				eslintConfig["extends"] = "prettier";
				await fs.writeFile(
					paths.eslintrc,
					YAML.stringify(eslintConfig),
					{ encoding: "utf8" }
				);
			}
		});
	}

	if (prettier) {
		await benchmark("Configuring prettier..", async () => {
			await fs.copy(configTemplate.prettierrc, paths.prettierrc);
			await fs.copy(configTemplate.prettierIgnore, paths.prettierIgnore);
		});
	}

	if (vscode) {
		await benchmark("Configuring vscode..", async () => {
			const extensions = {
				recommendations: ["roblox-ts.vscode-roblox-ts"],
			};
			// SDKS automaticaly resolves in vscode unless you are using yarn
			const settings = {
				"typescript.enablePromptUseWorkspaceTsdk": true,
			};

			if (eslint) {
				extensions.recommendations.push("dbaeumer.vscode-eslint");
				Object.assign(settings, {
					"[typescript]": {
						"editor.defaultFormatter": "dbaeumer.vscode-eslint",
						"editor.formatOnSave": true,
					},
					"[typescriptreact]": {
						"editor.defaultFormatter": "dbaeumer.vscode-eslint",
						"editor.formatOnSave": true,
					},
					"eslint.run": "onType",
					"eslint.format.enable": true,
				});
			}
			if (prettier) {
				// we still want to recommend the extension even IF eslint is enabled
				extensions.recommendations.push("esbenp.prettier-vscode");
				if (!eslint) {
					Object.assign(settings, {
						"[typescript]": {
							"editor.defaultFormatter": "esbenp.prettier-vscode",
							"editor.formatOnSave": true,
						},
						"[typescriptreact]": {
							"editor.defaultFormatter": "esbenp.prettier-vscode",
							"editor.formatOnSave": true,
						},
					});
				}
			}

			if (packageManager == PackageManager.Yarn3) {
				await cmd("yarn dlx @yarnpkg/sdks vscode");
				extensions.recommendations.push("arcanis.vscode-zipfs");
			}

			await fs.outputFile(
				paths.extensions,
				JSON.stringify(extensions, undefined, "\t")
			);
			await fs.outputFile(
				paths.settings,
				JSON.stringify(settings, undefined, "\t")
			);
		});
	}

	await benchmark("Copying template files..", async () => {
		await fs.copy(templateDir, cwd);
	});

	await benchmark("Compiling..", () => cmd("npm run build"));
}

const GAME_DESCRIPTION = "Generate a Roblox place";
const MODEL_DESCRIPTION = "Generate a Roblox model";
const PLUGIN_DESCRIPTION = "Generate a Roblox Studio plugin";
const PACKAGE_DESCRIPTION = "Generate a roblox-ts npm package";

/**
 * Defines behavior of `rbxtsc init` command.
 */
export = {
	command: "init",
	describe: "Create a project from a template",
	builder: () =>
		yargs
			.option("yes", {
				alias: "y",
				boolean: true,
				describe: "recommended options",
			})
			.option("git", {
				boolean: true,
				describe: "Configure Git",
			})
			.option("eslint", {
				boolean: true,
				describe: "Configure ESLint",
			})
			.option("prettier", {
				boolean: true,
				describe: "Configure Prettier",
			})
			.option("vscode", {
				boolean: true,
				describe: "Configure VSCode Project Settings",
			})
			.option("packageManager", {
				choices: Object.values(PackageManager),
				describe: "Choose an alternative package manager",
			})
			.command(
				[InitMode.Game, InitMode.Place],
				GAME_DESCRIPTION,
				{},
				(argv) => init(argv as never, InitMode.Game)
			)
			.command(InitMode.Model, MODEL_DESCRIPTION, {}, (argv) =>
				init(argv as never, InitMode.Model)
			)
			.command(InitMode.Plugin, PLUGIN_DESCRIPTION, {}, (argv) =>
				init(argv as never, InitMode.Plugin)
			)
			.command(InitMode.Package, PACKAGE_DESCRIPTION, {}, (argv) =>
				init(argv as never, InitMode.Package)
			),
	handler: (argv) => init(argv, InitMode.None),
	// eslint-disable-next-line @typescript-eslint/ban-types
} satisfies yargs.CommandModule<{}, InitOptions>;
