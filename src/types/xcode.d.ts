declare module 'xcode' {
  /** One entry in a build phase's `files` list. */
  interface PbxBuildPhaseFile {
    value: string;
    comment: string;
  }

  interface PbxBuildPhase {
    files: PbxBuildPhaseFile[];
  }

  interface PbxGroup {
    name?: string;
    path?: string;
    children?: PbxBuildPhaseFile[];
  }

  type PbxSection<T> = Record<string, T | string>;

  /**
   * Only the surface the iOS widget and push-extension plugins use. The package ships no types and
   * its object model is untyped by nature: every section is a raw dictionary
   * keyed by uuid, with a parallel `<uuid>_comment` entry beside each.
   */
  interface PbxProject {
    filepath: string;
    hash: {
      project: {
        objects: {
          PBXGroup: PbxSection<PbxGroup>;
          PBXBuildFile: PbxSection<{ fileRef: string }>;
          PBXFileReference: PbxSection<{ path: string }>;
          /** Absent until a target adds one, which `addTarget` does for an extension. */
          PBXCopyFilesBuildPhase?: Record<string, unknown>;
        };
      };
    };
    parseSync(): PbxProject;
    writeSync(): string;
    generateUuid(): string;
    hasFile(path: string): false | { path: string };
    pbxNativeTargetSection(): Record<string, { name: string }>;
    pbxFileReferenceSection(): Record<string, { path: string }>;
    pbxBuildFileSection(): Record<string, unknown>;
    pbxSourcesBuildPhaseObj(targetUuid: string): PbxBuildPhase;
    pbxXCBuildConfigurationSection(): Record<
      string,
      { buildSettings?: Record<string, string> } | string
    >;
    addSourceFile(path: string, opt: { target: string }, group?: string): false | { uuid: string };
    addToPbxBuildFileSection(file: unknown): void;
    addToPbxSourcesBuildPhase(file: unknown): void;
    findPBXGroupKey(criteria: { name: string }): string | undefined;
    getPBXGroupByKey(key: string): PbxGroup;
    addPbxGroup(files: string[], name: string, path: string): { uuid: string };
    addToPbxGroup(groupUuid: string, parentUuid: string): void;
    getFirstProject(): { firstProject: { mainGroup: string; targets: PbxBuildPhaseFile[] } };
  }

  function project(pbxprojPath: string): PbxProject;

  export { project };
  export default { project };
}
