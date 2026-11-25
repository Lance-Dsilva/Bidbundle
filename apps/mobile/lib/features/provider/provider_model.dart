import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum ProviderStatus { idle, loading, ready, failed }

class ProviderModel extends ChangeNotifier {
  ProviderModel(this.repository, {required this.onSessionExpired});
  final ProviderRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _generation = 0;
  bool _disposed = false;
  ProviderStatus status = ProviderStatus.idle;
  ProviderOverview? overview;
  String? message;
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
    overview = null;
    message = null;
    status = ProviderStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation) =>
      !_disposed && _owner == owner && generation == _generation;
  Future<void> load() async {
    final owner = _owner;
    if (_disposed || owner == null || status == ProviderStatus.loading) return;
    final generation = ++_generation;
    overview = null;
    message = null;
    status = ProviderStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadOverview();
      if (!_current(owner, generation)) return;
      overview = loaded;
      status = ProviderStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      status = ProviderStatus.failed;
      message = error is ApiFailure
          ? (error.kind == FailureKind.profileIncomplete
                ? 'Finish setting up your provider account to view its overview.'
                : error.message)
          : 'We could not load your provider overview. Please try again.';
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
