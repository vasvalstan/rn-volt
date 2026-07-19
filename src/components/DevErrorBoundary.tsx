import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { logDevError } from "../lib/devErrorLogger";

type Props = {
  children: ReactNode;
};

type State = {
  error?: Error;
  componentStack?: string;
};

export default class DevErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? undefined });
    logDevError("react-error-boundary", error, {
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!__DEV__ || !this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <Text style={styles.title}>Volt dev error</Text>
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
          <Text selectable style={styles.message}>
            {this.state.error.message}
          </Text>
          {this.state.error.stack ? (
            <Text selectable style={styles.stack}>
              {this.state.error.stack}
            </Text>
          ) : null}
          {this.state.componentStack ? (
            <Text selectable style={styles.stack}>
              {this.state.componentStack}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#180B0B",
    paddingHorizontal: 16,
    paddingTop: 64,
    paddingBottom: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },
  panel: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  panelContent: {
    padding: 14,
    gap: 12,
  },
  message: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  stack: {
    color: "#FFD9D9",
    fontSize: 12,
    lineHeight: 17,
  },
});
