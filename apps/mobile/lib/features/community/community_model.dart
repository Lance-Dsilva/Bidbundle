import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum CommunityStatus { idle, loading, ready, failed }

class CommunityModel extends ChangeNotifier {
  CommunityModel(this.repository, {required this.onSessionExpired});
  final CommunityRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _generation = 0;
  bool _disposed = false;
  CommunityStatus status = CommunityStatus.idle;
  CommunityHub? hub;
  String? message;
  String? expandedId;
  void toggleExpanded(String id) {
    if (status != CommunityStatus.ready ||
        hub == null ||
        !hub!.requests.any((item) => item.id == id)) {
      return;
    }
    expandedId = expandedId == id ? null : id;
    _emit();
  }

  void close() {
    final owner = _owner;
    clear();
    _owner = owner;
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id) {
    if (_owner == id) return;
    clear();
    if (id != null && id.isNotEmpty) _owner = id;
  }

  void clear() {
    _owner = null;
    _generation++;
    hub = null;
    expandedId = null;
    message = null;
    status = CommunityStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation) =>
      !_disposed && _owner == owner && generation == _generation;
  Future<void> load() async {
    final owner = _owner;
    if (_disposed || owner == null || status == CommunityStatus.loading) {
      return;
    }
    final generation = ++_generation;
    hub = null;
    expandedId = null;
    message = null;
    status = CommunityStatus.loading;
    _emit();
    try {
      final loaded = await repository.load();
      if (!_current(owner, generation)) return;
      hub = loaded;
      status = CommunityStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      status = CommunityStatus.failed;
      message = error is ApiFailure && error.kind == FailureKind.invalidResponse
          ? 'We could not load this community response. Large neighbourhoods may be unavailable in this preview.'
          : 'We could not load your neighbourhood. Please try again.';
      _emit();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
