// Scratch entry: the app's own components rendered on the page through react-native-web.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StyleSheet as NativeStyleSheet } from 'react-native';
import { Card } from '@/shared/ui/Card';
import { CardHeader } from '@/shared/ui/CardHeader';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { DataTable } from '@/shared/ui/DataTable';
import { StatTile } from '@/shared/ui/StatTile';

export const kit = {
  Card,
  CardHeader,
  Button,
  Badge,
  DataTable,
  StatTile,
  createRoot,
  StyleSheet: NativeStyleSheet,
  React,
};
