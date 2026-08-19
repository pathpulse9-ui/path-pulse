'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';

type Slot = {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
};

const PageActionsContext = createContext<Slot | null>(null);

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <PageActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </PageActionsContext.Provider>
  );
}

export function usePageActionsSlot(): ReactNode {
  return useContext(PageActionsContext)?.actions ?? null;
}

export function usePageActions(render: () => ReactNode, deps: DependencyList) {
  const setActions = useContext(PageActionsContext)?.setActions;
  useEffect(() => {
    setActions?.(render());
    return () => setActions?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions, ...deps]);
}
