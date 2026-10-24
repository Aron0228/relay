import 'package:flutter/material.dart';

abstract final class RelayTokens {
  static const sidebarWidth = 248.0;
  static const sidebarCollapsedWidth = 72.0;
  static const mobileBreakpoint = 700.0;
  static const content = Color(0xff0c0d0f);
  static const primary = Color(0xff818cf8);
  static const primaryHover = Color(0xffa5b4fc);
  static const onPrimary = Color(0xff17181b);
  static const selected = Color(0xff25263f);
  static const background = Color(0xff101113);
  static const surface = Color(0xff1b1d21);
  static const border = Color(0xff303238);
  static const text = Color(0xfff5f5f6);
  static const muted = Color(0xffa5a7ae);
  static const logo = Color(0xff777a80);
  static const buttonText = Color(0xff17181b);
  static const focus = primary;
  static const error = Color(0xffffb4ab);
  static const small = 12.0;
  static const medium = 24.0;
  static const large = 40.0;
  static const radius = 12.0;
  static const contentWidth = 400.0;

  static ThemeData get theme => ThemeData(
    brightness: Brightness.dark,
    scaffoldBackgroundColor: background,
    colorScheme: const ColorScheme.dark(
      primary: primary,
      onPrimary: onPrimary,
      primaryContainer: selected,
      onPrimaryContainer: primary,
      surface: surface,
      onSurface: text,
      error: error,
      secondary: focus,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: primary),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: primary,
      selectionColor: selected,
      selectionHandleColor: primary,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(double.infinity, 52),
        padding: const EdgeInsets.symmetric(horizontal: medium, vertical: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
        ),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
  );
}
