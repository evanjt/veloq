import { Directory } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Makes the documents directory the shared legacy mock names exist in the store the file
 * classes write through, which holds only directories it was asked to make.
 */
export function makeDocumentsDirectory(): void {
  const documents = new Directory(FileSystem.documentDirectory ?? '');
  if (!documents.exists) documents.create({ intermediates: true });
}
