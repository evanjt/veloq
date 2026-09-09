declare module 'xcode' {
  /** One entry in a build phase's `files` list. */
  interface PbxBuildPhaseFile {
    value: string;
    comment: string;
  }

  interface PbxBuildPhase {
    files: PbxBuildPhaseFile[];
  }

  /**
   * Only the surface the iOS widget plugin uses. The package ships no types and
   * its object model is untyped by nature: every section is a raw dictionary
   * keyed by uuid, with a parallel `<uuid>_comment` entry beside each.
   */
  interface PbxProject {
    parseSync(): PbxProject;
    generateUuid(): string;
    hasFile(path: string): false | { path: string };
    pbxNativeTargetSection(): Record<string, { name: string }>;
    pbxFileReferenceSection(): Record<string, { path: string }>;
    pbxBuildFileSection(): Record<string, unknown>;
    pbxSourcesBuildPhaseObj(targetUuid: string): PbxBuildPhase;
    addSourceFile(path: string, opt: { target: string }, group?: string): false | { uuid: string };
    addToPbxBuildFileSection(file: unknown): void;
    addToPbxSourcesBuildPhase(file: unknown): void;
    findPBXGroupKey(criteria: { name: string }): string | undefined;
    addPbxGroup(files: string[], name: string, path: string): { uuid: string };
    addToPbxGroup(groupUuid: string, parentUuid: string): void;
    getFirstProject(): { firstProject: { mainGroup: string } };
  }

  function project(pbxprojPath: string): PbxProject;

  export { project };
  export default { project };
}
