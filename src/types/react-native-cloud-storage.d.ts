declare module 'react-native-cloud-storage' {
  export const CloudStorage: {
    isCloudAvailable(): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    unlink(path: string): Promise<void>;
  };
}
