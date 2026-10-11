import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/app_scope.dart';
import 'features/apply/apply_start_page.dart';
import 'features/apply/request_page.dart';
import 'features/console/audit_page.dart';
import 'features/console/case_page.dart';
import 'features/console/cases_page.dart';
import 'features/console/copilot_page.dart';
import 'features/console/dashboard_page.dart';
import 'features/console/funds_page.dart';
import 'features/console/login_page.dart';
import 'features/console/ledger_page.dart';
import 'features/console/money_page.dart';
import 'features/console/shell.dart';
import 'features/fund/fund_page.dart';
import 'features/fund/thanks_page.dart';
import 'features/home/home_page.dart';

GoRouter buildRouter(AppServices services) {
  return GoRouter(
    refreshListenable: services.session,
    redirect: (context, state) {
      final path = state.uri.path;
      final inConsole = path.startsWith('/console');
      if (inConsole && path != '/console/login' && !services.session.signedIn) {
        return '/console/login?next=${Uri.encodeComponent(state.uri.toString())}';
      }
      return null;
    },
    errorBuilder: (context, state) => const HomePage(),
    routes: [
      GoRoute(path: '/', builder: (_, _) => const HomePage()),
      GoRoute(
        path: '/f/:slug',
        builder: (_, s) => FundPage(slug: s.pathParameters['slug']!, giftState: s.uri.queryParameters['gift']),
        routes: [
          GoRoute(path: 'apply', builder: (_, s) => ApplyStartPage(slug: s.pathParameters['slug']!)),
          GoRoute(
            path: 'thanks/:donationId',
            builder: (_, s) => ThanksPage(slug: s.pathParameters['slug']!, donationId: s.pathParameters['donationId']!),
          ),
        ],
      ),
      GoRoute(
        path: '/r/:id',
        builder: (_, s) => RequestPage(
          id: s.pathParameters['id']!,
          tokenFromLink: s.uri.queryParameters['t'],
          paypalResult: s.uri.queryParameters['paypal'],
        ),
      ),
      GoRoute(path: '/console/login', builder: (_, s) => LoginPage(next: s.uri.queryParameters['next'])),
      ShellRoute(
        builder: (context, state, child) => ConsoleShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/console', builder: (_, _) => const DashboardPage()),
          GoRoute(
            path: '/console/cases',
            builder: (_, s) => CasesPage(filter: s.uri.queryParameters['filter'] ?? 'review'),
          ),
          GoRoute(path: '/console/cases/:id', builder: (_, s) => CasePage(id: s.pathParameters['id']!)),
          GoRoute(path: '/console/money', builder: (_, _) => const MoneyPage()),
          GoRoute(path: '/console/ledger', builder: (_, _) => const LedgerPage()),
          GoRoute(path: '/console/copilot', builder: (_, _) => const CopilotPage()),
          GoRoute(path: '/console/funds', builder: (_, _) => const FundsPage()),
          GoRoute(path: '/console/audit', builder: (_, _) => const AuditPage()),
        ],
      ),
    ],
  );
}

/// Convenience for pages that need to send the user somewhere after an action.
extension GoTo on BuildContext {
  void goNamedPath(String path) => GoRouter.of(this).go(path);
}

class NotFound extends StatelessWidget {
  const NotFound({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Not found')));
}
