import 'package:flutter/material.dart';

/// Localized calendar date includes the year; time always states its UTC offset.
String localInstantLabel(BuildContext context, DateTime? instant) {
  if (instant == null) return 'Not specified';
  final local = instant.toLocal();
  final labels = MaterialLocalizations.of(context);
  final offset = local.timeZoneOffset;
  final minutes = offset.inMinutes.abs();
  final zone =
      'UTC${offset.isNegative ? '-' : '+'}${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';
  return '${labels.formatShortDate(local)}, ${labels.formatTimeOfDay(TimeOfDay.fromDateTime(local), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))} ($zone)';
}
