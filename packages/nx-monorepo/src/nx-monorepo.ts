// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { IgnoreFile, JsonFile, Project, TextFile, YamlFile } from "projen";
import { NodePackageManager, NodeProject } from "projen/lib/javascript";
import {
  TypeScriptProject,
  TypeScriptProjectOptions,
} from "projen/lib/typescript";

const NX_MONOREPO_PLUGIN_PATH: string = ".nx/plugins/nx-monorepo-plugin.js";

/**
 * Configuration for nx targetDependencies.
 */
export type TargetDependencies = { [target: string]: TargetDependency[] };

/**
 * Implicit Dependencies map.
 */
export type ImplicitDependencies = { [pkg: string]: string[] };

/**
 * Supported enums for a TargetDependency.
 */
export enum TargetDependencyProject {
  /**
   * Only rely on the package where the target is called.
   *
   * This is usually done for test like targets where you only want to run unit
   * tests on the target packages without testing all dependent packages.
   */
  SELF = "self",
  /**
   * Target relies on executing the target against all dependencies first.
   *
   * This is usually done for build like targets where you want to build all
   * dependant projects first.
   */
  DEPENDENCIES = "dependencies",
}

/**
 * Represents an NX Target Dependency.
 */
export interface TargetDependency {
  /**
   * Projen target i.e: build, test, etc
   */
  readonly target: string;

  /**
   * Target dependencies.
   */
  readonly projects: TargetDependencyProject;
}

/**
 * NX configurations.
 *
 * @link https://nx.dev/configuration/packagejson
 */
export interface NXConfig {
  /**
   * Configuration for Implicit Dependnecies.
   *
   * @link https://nx.dev/configuration/packagejson#implicitdependencies
   */
  readonly implicitDependencies?: ImplicitDependencies;

  /**
   * Configuration for TargetDependencies.
   *
   * @link https://nx.dev/configuration/packagejson#target-dependencies
   */
  readonly targetDependencies?: TargetDependencies;

  /**
   * List of patterns to include in the .nxignore file.
   *
   * @link https://nx.dev/configuration/packagejson#nxignore
   */
  readonly nxIgnore?: string[];
}

/**
 * Workspace configurations.
 *
 * @link https://classic.yarnpkg.com/lang/en/docs/workspaces/
 */
export interface WorkspaceConfig {
  /**
   * List of package globs to exclude from hoisting in the workspace.
   *
   * @link https://classic.yarnpkg.com/blog/2018/02/15/nohoist/
   */
  readonly noHoist?: string[];
}

/**
 * Configuration options for the NxMonorepoProject.
 */
export interface NxMonorepoProjectOptions extends TypeScriptProjectOptions {
  /**
   * Configuration for NX.
   */
  readonly nxConfig?: NXConfig;

  /**
   * Configuration for workspace.
   */
  readonly workspaceConfig?: WorkspaceConfig;
}

/**
 * This project type will bootstrap a NX based monorepo with support for polygot
 * builds, build caching, dependency graph visualization and much more.
 *
 * @pjid nx-monorepo
 */
export class NxMonorepoProject extends TypeScriptProject {
  // mutable data structures
  private readonly implicitDependencies: ImplicitDependencies;

  // immutable data structures
  private readonly nxConfig?: NXConfig;
  private readonly workspaceConfig?: WorkspaceConfig;

  constructor(options: NxMonorepoProjectOptions) {
    super({
      ...options,
      github: false,
      jest: false,
      package: false,
      prettier: true,
      projenrcTs: true,
      release: false,
      sampleCode: false,
      defaultReleaseBranch: "mainline",
    });

    this.nxConfig = options.nxConfig;
    this.workspaceConfig = options.workspaceConfig;
    this.implicitDependencies = this.nxConfig?.implicitDependencies || {};

    // Never publish a monorepo root package.
    this.package.addField("private", true);

    // No need to compile or test a monorepo root package.
    this.compileTask.reset();
    this.testTask.reset();

    this.addDevDeps("@nrwl/cli", "@nrwl/workspace");

    new IgnoreFile(this, ".nxignore").exclude(
      "test-reports",
      "target",
      ".env",
      ".pytest_cache",
      ...(this.nxConfig?.nxIgnore || [])
    );

    new TextFile(this, NX_MONOREPO_PLUGIN_PATH, {
      readonly: true,
      lines: fs.readFileSync(getPluginPath()).toString("utf-8").split("\n"),
    });

    new JsonFile(this, "nx.json", {
      obj: {
        extends: "@nrwl/workspace/presets/npm.json",
        plugins: [`./${NX_MONOREPO_PLUGIN_PATH}`],
        npmScope: "monorepo",
        tasksRunnerOptions: {
          default: {
            runner: "@nrwl/workspace/tasks-runners/default",
            options: {
              useDaemonProcess: false,
              cacheableOperations: ["build", "test"],
            },
          },
        },
        implicitDependencies: this.implicitDependencies,
        targetDependencies: {
          build: [
            {
              target: "build",
              projects: "dependencies",
            },
          ],
          ...(this.nxConfig?.targetDependencies || {}),
        },
        affected: {
          defaultBase: "mainline",
        },
      },
    });
  }

  /**
   * Create an implicit dependency between two Project's. This is typically
   * used in polygot repos where a Typescript project wants a build dependency
   * on a Python project as an example.
   *
   * @param dependent project you want to have the dependency.
   * @param dependee project you wish to depend on.
   */
  public addImplicitDependency(dependent: Project, dependee: Project) {
    if (this.implicitDependencies[dependent.name]) {
      this.implicitDependencies[dependent.name].push(dependee.name);
    } else {
      this.implicitDependencies[dependent.name] = [dependee.name];
    }
  }

  // Remove this hack once subProjects is made public in Projen
  protected get subProjects(): Project[] {
    // @ts-ignore
    const subProjects: Project[] = this.subprojects || [];
    return subProjects.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @inheritDoc
   */
  preSynthesize() {
    super.preSynthesize();

    // Add workspaces for each subproject
    if (this.package.packageManager === NodePackageManager.PNPM) {
      new YamlFile(this, "pnpm-workspace.yaml", {
        readonly: true,
        obj: {
          packages: this.subProjects.map((subProject) =>
            path.relative(this.outdir, subProject.outdir)
          ),
        },
      });
    } else {
      this.package.addField("workspaces", {
        packages: this.subProjects.map((subProject) =>
          path.relative(this.outdir, subProject.outdir)
        ),
        nohoist: this.workspaceConfig?.noHoist,
      });
    }

    this.subProjects.forEach((subProject: any) => {
      // Disable default task on subprojects as this isn't supported in a monorepo
      subProject.defaultTask?.reset();

      if (
        (subProject instanceof NodeProject || subProject.package) &&
        subProject.package.packageManager !== this.package.packageManager
      ) {
        throw new Error(
          `${subProject.name} packageManager does not match the monorepo packageManager: ${this.package.packageManager}.`
        );
      }
    });
  }

  /**
   * @inheritDoc
   */
  synth() {
    // Check to see if a new subProject was added
    const newSubProject = this.subProjects.find(
      (subProject) => !fs.existsSync(subProject.outdir)
    );

    // Need to synth before generating the package.json otherwise the subdirectory won't exist
    newSubProject && super.synth();

    this.subProjects
      .filter(
        (subProject) =>
          !subProject.tryFindObjectFile("package.json") ||
          (fs.existsSync(`${subProject.outdir}/package.json`) &&
            JSON.parse(
              fs.readFileSync(`${subProject.outdir}/package.json`).toString()
            ).__pdk__)
      )
      .forEach((subProject) => {
        // generate a package.json if not found
        const manifest: any = {};
        manifest.name = subProject.name;
        manifest.private = true;
        manifest.__pdk__ = true;
        manifest.scripts = subProject.tasks.all.reduce(
          (p, c) => ({
            [c.name]: `npx projen ${c.name}`,
            ...p,
          }),
          {}
        );
        manifest.version = "0.0.0";

        new JsonFile(subProject, "package.json", {
          obj: manifest,
          readonly: true,
        });
      });

    super.synth();
  }
}

function getPluginPath() {
  return path.join(__dirname, "plugin/nx-monorepo-plugin.js");
}
