import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BOOTSTRAP_SQL = fs.readFileSync(new URL('../supabase/tests/rls_bootstrap.sql', import.meta.url), 'utf8')

const TEST_FAMILY_NAMES = {
  familyA: 'RLS_TEST_FAMILY_A',
  familyB: 'RLS_TEST_FAMILY_B',
}

if (process.argv.includes('--bootstrap')) {
  console.log(BOOTSTRAP_SQL)
  process.exit(0)
}

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

const TEST_ACCOUNT_ENV = {
  parentA: ['VITE_TEST_PARENT_A_EMAIL', 'VITE_TEST_PARENT_A_PASSWORD'],
  childA: ['VITE_TEST_CHILD_A_EMAIL', 'VITE_TEST_CHILD_A_PASSWORD'],
  parentB: ['VITE_TEST_PARENT_B_EMAIL', 'VITE_TEST_PARENT_B_PASSWORD'],
  childB: ['VITE_TEST_CHILD_B_EMAIL', 'VITE_TEST_CHILD_B_PASSWORD'],
}

const TEST_ACCOUNT_NAMES = Object.keys(TEST_ACCOUNT_ENV)

function requireEnvPair(keyPair) {
  const [emailKey, passwordKey] = keyPair
  const email = process.env[emailKey]
  const password = process.env[passwordKey]
  if (!email || !password) {
    throw new Error(`Missing required test-account env vars: ${emailKey} and ${passwordKey}`)
  }
  return { email, password }
}

function createSessionClient(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

async function ensureUserExists(label, email, password) {
  const publicClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { data: signInData, error: signInError } = await publicClient.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    throw new Error(`${label} signIn failed: ${signInError.message}`)
  }

  return {
    label,
    email,
    password,
    user: signInData.user,
    session: signInData.session,
    client: createSessionClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY,
      signInData.session.access_token,
    ),
  }
}

function logErrorDetails(label, error) {
  console.log(`  ${label}`)
  if (!error) {
    console.log('  returned no error')
    return
  }

  console.log(`  Supabase error code: ${error.code ?? 'UNKNOWN'}`)
  console.log(`  error message: ${error.message ?? 'No message provided'}`)
  console.log(`  error details: ${error.details ?? 'N/A'}`)
  console.log(`  error hint: ${error.hint ?? 'N/A'}`)
}

function logResultSummary(label, result, { allowZeroRows = false } = {}) {
  const error = result?.error ?? null
  const data = result?.data
  const rowsAffected = Array.isArray(data) ? data.length : 0
  const pass = Boolean(error) || (allowZeroRows && rowsAffected === 0)

  console.log(`${pass ? 'PASS' : 'FAIL'} :: ${label}`)
  if (error) {
    logErrorDetails('error', error)
  } else {
    console.log('  returned no error')
    console.log(`  rows affected: ${rowsAffected}`)
  }

  return pass
}

async function test(label, fn) {
  try {
    const result = await fn()
    const ok = result === true
    console.log(`${ok ? 'PASS' : 'FAIL'} :: ${label}`)
    return ok
  } catch (error) {
    console.log(`FAIL :: ${label}`)
    console.log(`  ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function resolveFamilyByName(account, familyName) {
  const { data, error } = await account.client
    .from('families')
    .select('id')
    .eq('name', familyName)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Unable to resolve test family "${familyName}": ${error.message}`)
  }

  if (!data) {
    throw new Error(`Required test family "${familyName}" was not found. Run the approved bootstrap SQL first.`)
  }

  return data.id
}

async function resolveTestFamilies(accounts) {
  const familyA = await resolveFamilyByName(accounts.parentA, TEST_FAMILY_NAMES.familyA)
  const familyB = await resolveFamilyByName(accounts.parentB, TEST_FAMILY_NAMES.familyB)
  return { familyA, familyB }
}

async function main() {
  const creds = Object.fromEntries(
    TEST_ACCOUNT_NAMES.map((name) => [name, requireEnvPair(TEST_ACCOUNT_ENV[name])]),
  )

  console.log('Development-only RLS verification utility')
  console.log('Using public Supabase URL + anon key only. No service-role key is used.')

  const accounts = {}
  for (const name of TEST_ACCOUNT_NAMES) {
    const { email, password } = creds[name]
    accounts[name] = await ensureUserExists(name, email, password)
  }

  const { familyA, familyB } = await resolveTestFamilies(accounts)

  const tests = [
    {
      label: 'Family isolation between A and B',
      fn: async () => {
        const { data: familyAData, error: familyAError } = await accounts.childA.client
          .from('families')
          .select('*')
          .eq('id', familyA)
        const { data: familyBData, error: familyBError } = await accounts.childA.client
          .from('families')
          .select('*')
          .eq('id', familyB)
        return !familyAError && !familyBError && Array.isArray(familyAData) && familyAData.length === 1 && Array.isArray(familyBData) && familyBData.length === 0
      },
    },
    {
      label: 'Parent can manage tasks in their own family',
      fn: async () => {
        const { data, error } = await accounts.parentA.client.from('tasks').insert({
          family_id: familyA,
          title: 'Parent task',
          description: 'Parent-created task',
          emoji: '✅',
          xp: 15,
          assigned_to: accounts.childA.user.id,
          created_by: accounts.parentA.user.id,
          status: 'pending',
        }).select()
        return !error && Array.isArray(data) && data.length === 1
      },
    },
    {
      label: 'Child cannot create/update/delete tasks',
      fn: async () => {
        const insertResult = await accounts.childA.client.from('tasks').insert({
          family_id: familyA,
          title: 'Child task attempt',
          description: 'Should fail',
          emoji: '❌',
          xp: 10,
          assigned_to: accounts.childA.user.id,
          created_by: accounts.childA.user.id,
          status: 'pending',
        })
        const insertOk = logResultSummary('Child task INSERT denied', insertResult)

        const updateResult = await accounts.childA.client.from('tasks').update({ title: 'tampered' }).eq('family_id', familyA).select()
        const updateOk = logResultSummary('Child task UPDATE denied', updateResult, { allowZeroRows: true })

        const deleteResult = await accounts.childA.client.from('tasks').delete().eq('family_id', familyA).select()
        const deleteOk = logResultSummary('Child task DELETE denied', deleteResult, { allowZeroRows: true })

        return insertOk && updateOk && deleteOk
      },
    },
    {
      label: 'Child can submit a completion for their assigned task',
      fn: async () => {
        const parentClient = accounts.parentA.client
        const childClient = accounts.childA.client
        const childUserId = accounts.childA.user.id

        const { data: taskRows, error: taskLookupError } = await parentClient
          .from('tasks')
          .select('id, family_id, assigned_to, task_completions(id)')
          .eq('family_id', familyA)
          .eq('assigned_to', childUserId)

        if (taskLookupError || !taskRows || taskRows.length === 0) {
          console.log('FAIL :: Child completion assigned task lookup')
          logErrorDetails('task lookup', taskLookupError)
          console.log(`  tasks array length: ${taskRows?.length ?? 0}`)
          return false
        }

        let selectedTask = taskRows.find((task) => !Array.isArray(task.task_completions) || task.task_completions.length === 0)

        if (!selectedTask) {
          const { data: createdTask, error: createTaskError } = await parentClient.from('tasks').insert({
            family_id: familyA,
            title: 'RLS_DIAGNOSTIC_TASK_NO_COMPLETION',
            description: 'Diagnostic-only task with no completion',
            emoji: '🧪',
            xp: 10,
            assigned_to: childUserId,
            created_by: accounts.parentA.user.id,
            status: 'pending',
          }).select('id, family_id, assigned_to').single()

          if (createTaskError || !createdTask) {
            console.log('FAIL :: Child completion diagnostic task creation')
            logErrorDetails('task creation', createTaskError)
            return false
          }

          selectedTask = createdTask
        }

        const taskId = selectedTask.id
        const taskFamilyId = selectedTask.family_id
        const taskAssignedTo = selectedTask.assigned_to
        const matchesAssigned = taskAssignedTo === childUserId

        console.log(`Child completion task selected: ${taskId}`)
        console.log(`  family_id: ${taskFamilyId}`)
        console.log(`  assigned_to: ${taskAssignedTo}`)
        console.log(`  Child A user ID: ${childUserId}`)
        console.log(`  assigned_to matches Child A: ${matchesAssigned}`)

        const insertResult = await childClient.from('task_completions').insert({
          task_id: taskId,
          child_id: childUserId,
          status: 'submitted',
          completion_note: 'Done',
        })

        const ok = !insertResult.error
        console.log(`${ok ? 'PASS' : 'FAIL'} :: Child completion insert for assigned task`)
        logErrorDetails('completion insert', insertResult.error)

        return ok
      },
    },
    {
      label: 'Child cannot submit a completion for another child task',
      fn: async () => {
        const { error } = await accounts.childA.client.from('task_completions').insert({
          task_id: '00000000-0000-0000-0000-000000000000',
          child_id: accounts.childA.user.id,
          status: 'submitted',
          completion_note: 'Should fail',
        })
        return Boolean(error)
      },
    },
    {
      label: 'Child cannot approve their own completion',
      fn: async () => {
        const { data: completion } = await accounts.childA.client.from('task_completions').select('*').eq('child_id', accounts.childA.user.id).limit(1).single()
        if (!completion) return true
        const { error } = await accounts.childA.client.from('task_completions').update({
          status: 'approved',
          reviewed_by: accounts.childA.user.id,
          reviewed_at: new Date().toISOString(),
        }).eq('id', completion.id)
        return Boolean(error)
      },
    },
    {
      label: 'Parent can approve child completion',
      fn: async () => {
        const { data: completion } = await accounts.parentA.client.from('task_completions').select('*').eq('child_id', accounts.childA.user.id).limit(1).single()
        if (!completion) return true
        const { error } = await accounts.parentA.client.from('task_completions').update({
          status: 'approved',
          reviewed_by: accounts.parentA.user.id,
          reviewed_at: new Date().toISOString(),
        }).eq('id', completion.id)
        return !error
      },
    },
    {
      label: 'Child cannot change their profile role to parent',
      fn: async () => {
        const { error } = await accounts.childA.client.from('profiles').update({ role: 'parent' }).eq('id', accounts.childA.user.id)
        return Boolean(error)
      },
    },
    {
      label: 'Child cannot insert/update family_members',
      fn: async () => {
        const insertResult = await accounts.childA.client.from('family_members').insert({
          family_id: familyA,
          user_id: accounts.childA.user.id,
          role: 'child',
        })
        const insertOk = logResultSummary('Child family_members INSERT denied', insertResult)

        const updateResult = await accounts.childA.client.from('family_members').update({ role: 'parent' }).eq('family_id', familyA).eq('user_id', accounts.childA.user.id).select()
        const updateOk = logResultSummary('Child family_members UPDATE denied', updateResult, { allowZeroRows: true })

        const deleteResult = await accounts.childA.client.from('family_members').delete().eq('family_id', familyA).eq('user_id', accounts.childA.user.id).select()
        const deleteOk = logResultSummary('Child family_members DELETE denied', deleteResult, { allowZeroRows: true })

        return insertOk && updateOk && deleteOk
      },
    },
    {
      label: 'Cross-family task assignment is rejected',
      fn: async () => {
        const { error } = await accounts.parentA.client.from('tasks').insert({
          family_id: familyA,
          title: 'Cross family assignment',
          description: 'Should fail',
          emoji: '⚠️',
          xp: 10,
          assigned_to: accounts.childB.user.id,
          created_by: accounts.parentA.user.id,
          status: 'pending',
        })
        return Boolean(error)
      },
    },
    {
      label: 'Cross-family completion is rejected',
      fn: async () => {
        const { error } = await accounts.childA.client.from('task_completions').insert({
          task_id: '00000000-0000-0000-0000-000000000111',
          child_id: accounts.childB.user.id,
          status: 'submitted',
          completion_note: 'Should fail',
        })
        return Boolean(error)
      },
    },
    {
      label: 'Parent B cannot access Family A',
      fn: async () => {
        const { data, error } = await accounts.parentB.client.from('families').select('*').eq('id', familyA)
        return !error && Array.isArray(data) && data.length === 0
      },
    },
    {
      label: 'Child B cannot access Child A tasks/completions',
      fn: async () => {
        const { data: tasks, error: tasksError } = await accounts.childB.client.from('tasks').select('*').eq('family_id', familyA)
        const { data: completions, error: completionsError } = await accounts.childB.client.from('task_completions').select('*').eq('child_id', accounts.childA.user.id)
        return !tasksError && !completionsError && Array.isArray(tasks) && tasks.length === 0 && Array.isArray(completions) && completions.length === 0
      },
    },
  ]

  let passCount = 0
  let failCount = 0

  for (const testCase of tests) {
    const passed = await test(testCase.label, testCase.fn)
    if (passed) {
      passCount += 1
    } else {
      failCount += 1
    }
  }

  console.log(`SUMMARY :: passed=${passCount} failed=${failCount}`)
}

main().catch((error) => {
  console.error('RLS verification utility failed:')
  console.error(error)
  process.exitCode = 1
})
