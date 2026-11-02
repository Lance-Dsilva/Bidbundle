import 'package:flutter/material.dart';

import 'home_model.dart';
import '../requests/requests_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.model});
  final HomeModel model;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.model.initialize();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        widget.model.signedIn &&
        !widget.model.busy) {
      widget.model.refresh();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.model, widget.model.requests]),
    builder: (context, _) {
      final model = widget.model;
      final data = model.data;
      final dashboard = data?.dashboard;
      final requestsVisible = model.canViewRequests && model.showRequests;
      final detailVisible =
          requestsVisible && model.requests.selectedId != null;
      return PopScope<void>(
        canPop: !requestsVisible,
        onPopInvokedWithResult: (didPop, result) {
          if (didPop) return;
          if (!detailVisible && requestsVisible) model.showHome();
        },
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Bundleen'),
            leading: detailVisible
                ? BackButton(onPressed: model.requests.closeDetail)
                : null,
            actions: requestsVisible
                ? [
                    TextButton(
                      onPressed: model.signOut,
                      child: const Text('Sign out'),
                    ),
                  ]
                : null,
            backgroundColor: const Color(0xfff8f6ef),
          ),
          bottomNavigationBar: model.canViewRequests
              ? NavigationBar(
                  selectedIndex: requestsVisible ? 1 : 0,
                  onDestinationSelected: (index) {
                    if (index == 0) {
                      model.showHome();
                    } else {
                      model.openRequests();
                    }
                  },
                  destinations: const [
                    NavigationDestination(
                      icon: Icon(Icons.home_outlined),
                      label: 'Home',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.list_alt),
                      label: 'Requests',
                    ),
                  ],
                )
              : null,
          body: SafeArea(
            child: requestsVisible
                ? RequestsNavigator(model: model.requests)
                : ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        model.signedIn
                            ? 'Your neighborhood, together.'
                            : 'Home services, with your neighbors.',
                        style: Theme.of(context).textTheme.headlineLarge
                            ?.copyWith(
                              fontFamily:
                                  Theme.of(context).platform ==
                                      TargetPlatform.iOS
                                  ? 'Georgia'
                                  : 'serif',
                            ),
                      ),
                      const SizedBox(height: 16),
                      if (!model.signedIn)
                        const Text(
                          'Sign in to see your Bundleen account and current requests.',
                        ),
                      if (model.message != null)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: Semantics(
                            liveRegion: true,
                            child: Text(model.message!),
                          ),
                        ),
                      if (model.busy)
                        const Padding(
                          padding: EdgeInsets.all(32),
                          child: Center(
                            child: CircularProgressIndicator(
                              semanticsLabel: 'Loading your account',
                            ),
                          ),
                        ),
                      if (!model.busy &&
                          !model.signedIn &&
                          !model.logoutPending &&
                          model.initialized) ...[
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: model.authenticate,
                          child: const Text('Sign in'),
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton(
                          onPressed: () =>
                              model.authenticate(createAccount: true),
                          child: const Text('Create an account'),
                        ),
                      ],
                      if (!model.busy && !model.initialized) ...[
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: model.initialize,
                          child: const Text('Retry secure connection'),
                        ),
                      ],
                      if (data != null) ...[
                        Text(
                          data.profile.name,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(data.context.roleLabel),
                        const SizedBox(height: 24),
                        if (dashboard != null) ...[
                          if (dashboard.coldStart)
                            const Text(
                              'Your requests will appear here once you get started.',
                            ),
                          _summary(
                            'Active requests',
                            '${dashboard.activeRequests}',
                          ),
                          _summary('Active bids', '${dashboard.activeBids}'),
                          _summary(
                            'Recorded savings',
                            '\$${(dashboard.savedCents / 100).toStringAsFixed(2)}',
                          ),
                          const Text(
                            'Based on your recorded requests and agreements. Discounts are not guaranteed.',
                          ),
                        ] else
                          const Text(
                            'This mobile preview currently supports the homeowner overview. Your account’s other workflows are not yet available here.',
                          ),
                      ],
                      if (model.signedIn && !model.busy) ...[
                        const SizedBox(height: 24),
                        OutlinedButton(
                          onPressed: model.refresh,
                          child: const Text('Refresh'),
                        ),
                      ],
                      if (model.signedIn ||
                          (model.logoutPending && !model.busy)) ...[
                        const SizedBox(height: 12),
                        OutlinedButton(
                          onPressed: model.signOut,
                          child: Text(
                            model.logoutPending ? 'Retry sign out' : 'Sign out',
                          ),
                        ),
                      ],
                      const SizedBox(height: 32),
                      Text(
                        '${model.config.environment} · Mobile engineering preview',
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                    ],
                  ),
          ),
        ),
      );
    },
  );
  Widget _summary(String label, String value) => Card(
    margin: const EdgeInsets.symmetric(vertical: 8),
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label),
          const SizedBox(height: 8),
          Text(value, style: Theme.of(context).textTheme.headlineMedium),
        ],
      ),
    ),
  );
}
