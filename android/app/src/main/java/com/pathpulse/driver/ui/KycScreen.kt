package com.pathpulse.driver.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.CarretKycDocumentSubmission
import com.pathpulse.driver.network.CarretKycStatus
import com.pathpulse.driver.network.CarretSubAccountInput
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.UserErrors
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.components.PpSecondaryButton
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpBlue50
import com.pathpulse.driver.ui.theme.PpBlue700
import com.pathpulse.driver.ui.theme.PpGreen100
import com.pathpulse.driver.ui.theme.PpGreen700
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed100
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpRed700
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Carret KYC — 6-section flow (PAT-79). Kotlin/Compose mirror of the iOS
 * `KycView` and the web `/dashboard/kyc` page. Handles PAN JSON, Aadhaar
 * XML file upload, selfie image upload, and 3s status polling.
 */
private enum class Step { Account, Initiate, Pan, Aadhaar, Selfie, Polling, Done }

private sealed class StepStatus {
    object Idle : StepStatus()
    data class Busy(val message: String? = null) : StepStatus()
    data class Success(val message: String? = null) : StepStatus()
    data class Error(val message: String) : StepStatus()
}

private val OCCUPATIONS = listOf(
    "Private Job", "Goverment Job", "Business Owner", "Home Maker",
    "Freelancer", "Unemployed", "Student", "Professional",
)
private val INCOMES = listOf(
    "< ₹5 Lakhs", "₹5 Lakhs-₹10 Lakhs", "₹10 Lakhs-₹25 Lakhs",
    "₹25 Lakhs-₹50 Lakhs", "₹50 Lakhs-1 Crore", ">₹1 Crore",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KycScreen(
    modifier: Modifier = Modifier,
    dataRepository: DataRepository = remember { DataRepository() },
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    val steps = remember {
        mutableStateOf<Map<Step, StepStatus>>(Step.entries.associateWith { StepStatus.Idle })
    }
    fun setStep(step: Step, s: StepStatus) {
        steps.value = steps.value.toMutableMap().apply { put(step, s) }
    }

    // Section 1
    var accountId by remember { mutableStateOf("") }
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var dob by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("IN") }
    var gender by remember { mutableStateOf("male") }
    var occupation by remember { mutableStateOf("Business Owner") }
    var income by remember { mutableStateOf("₹5 Lakhs-₹10 Lakhs") }

    // Section 2
    var sessionId by remember { mutableStateOf("") }

    // Section 3
    var panNumber by remember { mutableStateOf("") }
    var panName by remember { mutableStateOf("") }
    var panDob by remember { mutableStateOf("") }

    // Section 4 + 5 file picks — GetContent returns a content:// Uri.
    var aadhaarUri by remember { mutableStateOf<Uri?>(null) }
    var selfieUri  by remember { mutableStateOf<Uri?>(null) }
    val pickAadhaar = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { aadhaarUri = it }
    val pickSelfie = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { selfieUri = it }

    // Section 6
    var kycStatus by remember { mutableStateOf<CarretKycStatus?>(null) }
    var pollError by remember { mutableStateOf<String?>(null) }

    fun readUri(uri: Uri): Pair<String, ByteArray>? {
        val name = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (c.moveToFirst() && idx >= 0) c.getString(idx) else null
        } ?: "file"
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        return name to bytes
    }

    // Polling loop — only runs while step Polling is Busy.
    LaunchedEffect(steps.value[Step.Polling]) {
        val s = steps.value[Step.Polling]
        if (s !is StepStatus.Busy) return@LaunchedEffect
        while (isActive) {
            try {
                val st = dataRepository.getCarretKycStatus(accountId)
                kycStatus = st
                pollError = null
                when (st.kyc_status) {
                    "verified" -> {
                        setStep(Step.Polling, StepStatus.Success("All set. You're ready to withdraw to your bank."))
                        setStep(Step.Done, StepStatus.Success("You're all done."))
                        break
                    }
                    "rejected" -> {
                        setStep(Step.Polling, StepStatus.Error("Something didn't match. Tap Start over and try again."))
                        break
                    }
                    "manual_review" -> setStep(Step.Polling, StepStatus.Busy("Our team is taking a closer look. This can take a few hours."))
                }
            } catch (e: Exception) {
                pollError = UserErrors.message(e)
            }
            delay(3000)
        }
    }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(vertical = PpSpace.lg),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        // Header
        Column(verticalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
            Text("Verify your identity", style = MaterialTheme.typography.headlineMedium)
            Text(
                "A quick check so you can withdraw to your bank. Have your PAN and Aadhaar handy.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
            )
        }

        // Section 1 — Sub-account
        Section(1, "Your details", steps.value[Step.Account]!!) {
            Text(
                "A few basics we need on file before we can start verification.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
                modifier = Modifier.padding(bottom = PpSpace.sm),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
                Field("First name", firstName, { firstName = it }, Modifier.weight(1f))
                Field("Last name",  lastName,  { lastName  = it }, Modifier.weight(1f))
            }
            Field("Email", email, { email = it }, keyboard = KeyboardType.Email, placeholder = "you+kyc@gmail.com")
            Field("Phone (12 char, no +)", phone, { phone = it }, keyboard = KeyboardType.Phone, placeholder = "919XXXXXXXXX")
            Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
                Field("DOB (dd/mm/yyyy)", dob, { dob = it }, Modifier.weight(1f), placeholder = "18/04/2003")
                Field("Country (ISO-2)", country, { country = it }, Modifier.weight(1f))
            }
            DropdownField("Gender",     gender,     listOf("male", "female", "other")) { gender = it }
            DropdownField("Occupation", occupation, OCCUPATIONS)                        { occupation = it }
            DropdownField("Income",     income,     INCOMES)                            { income = it }

            PpPrimaryButton(
                text = if (steps.value[Step.Account] is StepStatus.Busy) "Saving…" else "Save details",
                enabled = steps.value[Step.Account] !is StepStatus.Busy,
                onClick = {
                    scope.launch {
                        setStep(Step.Account, StepStatus.Busy("Saving your details…"))
                        try {
                            val acc = dataRepository.createCarretSubAccount(
                                CarretSubAccountInput(
                                    email = email,
                                    phone_number = phone.replace("+", ""),
                                    first_name = firstName, last_name = lastName,
                                    dob = dob, country = country,
                                    gender = gender,
                                    occupation = occupation,
                                    annual_income = income,
                                ),
                            )
                            accountId = acc.id.toString()
                            setStep(Step.Account, StepStatus.Success("Details saved."))
                        } catch (e: Exception) {
                            setStep(Step.Account, StepStatus.Error(UserErrors.message(e)))
                        }
                    }
                },
                modifier = Modifier.padding(top = PpSpace.md),
            )
            Field(
                "…or paste an existing pending account id",
                accountId, { accountId = it },
                Modifier.padding(top = PpSpace.md),
                keyboard = KeyboardType.Number,
                placeholder = "48560",
            )
        }

        // Section 2 — Start verification
        Section(2, "Start verification", steps.value[Step.Initiate]!!) {
            PpPrimaryButton(
                text = if (steps.value[Step.Initiate] is StepStatus.Busy) "Starting…" else "Start verification",
                enabled = accountId.isNotEmpty() && steps.value[Step.Initiate] !is StepStatus.Busy,
                onClick = {
                    scope.launch {
                        setStep(Step.Initiate, StepStatus.Busy("Getting things ready…"))
                        try {
                            val r = dataRepository.initiateCarretKyc(accountId)
                            sessionId = r.session.session_id
                            setStep(Step.Initiate, StepStatus.Success("Ready — please submit your documents below."))
                        } catch (e: Exception) {
                            setStep(Step.Initiate, StepStatus.Error(UserErrors.message(e)))
                        }
                    }
                },
            )
        }

        // Section 3 — PAN
        Section(3, "PAN card", steps.value[Step.Pan]!!) {
            Text(
                "Enter these exactly as printed on your PAN card.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
                modifier = Modifier.padding(bottom = PpSpace.sm),
            )
            Field("PAN number (10 characters)", panNumber, { panNumber = it.uppercase() },
                  placeholder = "ABCDE1234F",
                  keyboardCapitalization = KeyboardCapitalization.Characters)
            Field("Name on card", panName, { panName = it })
            Field("Date of birth (dd/mm/yyyy)", panDob, { panDob = it }, placeholder = "18/04/2003")
            PpPrimaryButton(
                text = if (steps.value[Step.Pan] is StepStatus.Busy) "Checking…" else "Submit PAN",
                enabled = sessionId.isNotEmpty() && steps.value[Step.Pan] !is StepStatus.Busy,
                onClick = {
                    scope.launch {
                        setStep(Step.Pan, StepStatus.Busy("Checking your PAN…"))
                        try {
                            dataRepository.submitCarretKycDocument(
                                sessionId,
                                CarretKycDocumentSubmission(
                                    document_type = "pan",
                                    document_number = panNumber.uppercase(),
                                    name = panName, dob = panDob,
                                ),
                            )
                            setStep(Step.Pan, StepStatus.Success("PAN accepted."))
                        } catch (e: Exception) {
                            setStep(Step.Pan, StepStatus.Error(UserErrors.message(e)))
                        }
                    }
                },
                modifier = Modifier.padding(top = PpSpace.md),
            )
        }

        // Section 4 — Aadhaar XML
        Section(4, "Aadhaar file", steps.value[Step.Aadhaar]!!) {
            Text(
                "Open DigiLocker → Aadhaar → Share as XML. Upload the ZIP file you get here.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
                modifier = Modifier.padding(bottom = PpSpace.sm),
            )
            PpSecondaryButton(
                text = aadhaarUri?.lastPathSegment ?: "Choose Aadhaar file",
                onClick = { pickAadhaar.launch("*/*") },
            )
            PpPrimaryButton(
                text = if (steps.value[Step.Aadhaar] is StepStatus.Busy) "Uploading…" else "Upload Aadhaar",
                enabled = aadhaarUri != null && sessionId.isNotEmpty() && steps.value[Step.Aadhaar] !is StepStatus.Busy,
                onClick = {
                    scope.launch {
                        val uri = aadhaarUri ?: return@launch
                        val (name, bytes) = readUri(uri) ?: return@launch
                        setStep(Step.Aadhaar, StepStatus.Busy("Uploading Aadhaar…"))
                        try {
                            dataRepository.uploadCarretKycFile(
                                kycSession = sessionId, docType = "aadhaar",
                                fileType = "xml", filename = name,
                                fileBytes = bytes, mimeType = "application/xml",
                            )
                            setStep(Step.Aadhaar, StepStatus.Success("Aadhaar received."))
                        } catch (e: Exception) {
                            setStep(Step.Aadhaar, StepStatus.Error(UserErrors.message(e)))
                        }
                    }
                },
                modifier = Modifier.padding(top = PpSpace.md),
            )
        }

        // Section 5 — Selfie
        Section(5, "Selfie", steps.value[Step.Selfie]!!) {
            Text(
                "Take a clear, well-lit photo facing the camera. Plain background works best.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
                modifier = Modifier.padding(bottom = PpSpace.sm),
            )
            PpSecondaryButton(
                text = selfieUri?.lastPathSegment ?: "Choose selfie",
                onClick = { pickSelfie.launch("image/*") },
            )
            PpPrimaryButton(
                text = if (steps.value[Step.Selfie] is StepStatus.Busy) "Uploading…" else "Upload selfie",
                enabled = selfieUri != null && sessionId.isNotEmpty() && steps.value[Step.Selfie] !is StepStatus.Busy,
                onClick = {
                    scope.launch {
                        val uri = selfieUri ?: return@launch
                        val (name, bytes) = readUri(uri) ?: return@launch
                        setStep(Step.Selfie, StepStatus.Busy("Uploading your photo…"))
                        try {
                            dataRepository.uploadCarretKycFile(
                                kycSession = sessionId, docType = "selfie",
                                fileType = "image", filename = name,
                                fileBytes = bytes, mimeType = "image/jpeg",
                            )
                            setStep(Step.Selfie, StepStatus.Success("Photo received."))
                            setStep(Step.Polling, StepStatus.Busy("Checking your verification…"))
                        } catch (e: Exception) {
                            setStep(Step.Selfie, StepStatus.Error(UserErrors.message(e)))
                        }
                    }
                },
                modifier = Modifier.padding(top = PpSpace.md),
            )
        }

        // Section 6 — Status
        if (steps.value[Step.Selfie] is StepStatus.Success || kycStatus != null) {
            Section(6, "Verification status", steps.value[Step.Polling]!!) {
                val s = kycStatus
                if (s != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Status:", style = MaterialTheme.typography.bodySmall, color = PpBlack50)
                        StatusPill(label = friendlyStatus(s.kyc_status), modifier = Modifier.padding(start = PpSpace.sm))
                    }
                    val explainer = when (s.kyc_status) {
                        "verified"      -> "All set. You're ready to withdraw to your bank."
                        "rejected"      -> "Something didn't match. Tap Start over and try again with clearer documents."
                        "manual_review" -> "Our team is taking a closer look. This can take a few hours."
                        else            -> null
                    }
                    if (explainer != null) {
                        Text(
                            explainer,
                            style = MaterialTheme.typography.bodySmall,
                            color = PpBlack70,
                            modifier = Modifier.padding(top = PpSpace.sm),
                        )
                    }
                } else {
                    Text("Checking your verification…", style = MaterialTheme.typography.bodySmall, color = PpBlack50)
                }
                PpSecondaryButton(
                    text = "Start over",
                    onClick = {
                        scope.launch {
                            try {
                                dataRepository.cleanupCarretKyc(accountId)
                                sessionId = ""; kycStatus = null
                                listOf(Step.Initiate, Step.Pan, Step.Aadhaar, Step.Selfie, Step.Polling, Step.Done).forEach {
                                    setStep(it, StepStatus.Idle)
                                }
                            } catch (e: Exception) {
                                pollError = UserErrors.message(e)
                            }
                        }
                    },
                    modifier = Modifier.padding(top = PpSpace.md),
                )
            }
        }
    }
}

private fun friendlyStatus(raw: String): String = when (raw) {
    "verified"      -> "verified"
    "pending"       -> "in progress"
    "manual_review" -> "under review"
    "rejected"      -> "needs attention"
    else            -> raw
}

@Composable
private fun Section(num: Int, title: String, status: StepStatus, content: @Composable () -> Unit) {
    PpCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$num.", style = MaterialTheme.typography.titleMedium, color = PpBlack40)
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = PpSpace.sm).weight(1f),
            )
            StepBadge(status)
        }
        val msg = when (status) {
            is StepStatus.Busy    -> status.message
            is StepStatus.Success -> status.message
            is StepStatus.Error   -> status.message
            else -> null
        }
        if (msg != null) {
            Text(
                msg,
                style = MaterialTheme.typography.bodySmall,
                color = if (status is StepStatus.Error) PpRed600 else PpBlack70,
                modifier = Modifier.padding(top = PpSpace.xs),
            )
        }
        Column(modifier = Modifier.padding(top = PpSpace.sm)) { content() }
    }
}

@Composable
private fun StepBadge(status: StepStatus) {
    val (label, bg, fg) = when (status) {
        StepStatus.Idle           -> return
        is StepStatus.Busy        -> Triple("Running…", PpBlue50, PpBlue700)
        is StepStatus.Success     -> Triple("Done",      PpGreen100, PpGreen700)
        is StepStatus.Error       -> Triple("Error",     PpRed100,   PpRed700)
    }
    Box(
        modifier = Modifier
            .clip(PpPillShape)
            .background(bg)
            .padding(horizontal = PpSpace.sm, vertical = 3.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}

@Composable
private fun StatusPill(label: String, modifier: Modifier = Modifier) {
    val (bg, fg) = when (label) {
        "verified"      -> PpGreen100 to PpGreen700
        "rejected"      -> PpRed100 to PpRed700
        "manual_review" -> Color(0xFFFEF3C7) to Color(0xFFB45309)
        else            -> PpBlue50 to PpBlue700
    }
    Box(
        modifier = modifier
            .clip(PpPillShape)
            .background(bg)
            .padding(horizontal = PpSpace.sm, vertical = 3.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    keyboardCapitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    placeholder: String = "",
) {
    Column(modifier = modifier.padding(vertical = PpSpace.xs)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack50)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            placeholder = { Text(placeholder) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = keyboardCapitalization),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = PpBlack05,
                unfocusedContainerColor = PpBlack05,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownField(label: String, value: String, options: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier = Modifier.padding(vertical = PpSpace.xs)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack50)
        Box {
            OutlinedTextField(
                value = value,
                onValueChange = {},
                readOnly = true,
                singleLine = true,
                trailingIcon = {
                    TextButton(onClick = { expanded = true }) { Text("▾", color = PpBlack70) }
                },
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = PpBlack05,
                    unfocusedContainerColor = PpBlack05,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { opt ->
                    DropdownMenuItem(
                        text = { Text(opt) },
                        onClick = { onSelect(opt); expanded = false },
                    )
                }
            }
        }
    }
}
